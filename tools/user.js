'use strict';

const { getModel } = require('./database/model');
const dbQuery = require('./database/query');
const { has, omit, pick, each, differenceWith, isEqual, isString, isNumber, isBoolean } = require('lodash');
const { isEmail } = require('validator');
const { SERVER_PATH } = require('../constants');
const {
	SIGNUP_NOT_AVAILABLE,
	PROVIDE_VALID_EMAIL,
	USER_EXISTS,
	INVALID_PASSWORD,
	INVALID_VERIFICATION_CODE,
	USER_NOT_FOUND,
	USER_NOT_VERIFIED,
	USER_NOT_ACTIVATED,
	INVALID_CREDENTIALS,
	INVALID_OTP_CODE,
	USERNAME_CANNOT_BE_CHANGED,
	USERNAME_IS_TAKEN,
	INVALID_USERNAME,
	ACCOUNT_NOT_VERIFIED,
	INVALID_VERIFICATION_LEVEL,
	USER_IS_VERIFIED,
	NO_DATA_FOR_CSV,
	PROVIDE_USER_CREDENTIALS,
	PROVIDE_KIT_ID,
	PROVIDE_NETWORK_ID,
	CANNOT_DEACTIVATE_ADMIN,
	USER_ALREADY_DEACTIVATED,
	USER_NOT_DEACTIVATED,
	CANNOT_CHANGE_ADMIN_ROLE,
	VERIFICATION_CODE_USED
} = require(`${SERVER_PATH}/messages`);
const { publisher } = require('./database/redis');
const {
	CONFIGURATION_CHANNEL,
	AUDIT_KEYS,
	USER_FIELD_ADMIN_LOG,
	ADDRESS_FIELDS,
	ID_FIELDS,
	SETTING_KEYS,
	OMITTED_USER_FIELDS,
	DEFAULT_ORDER_RISK_PERCENTAGE
} = require(`${SERVER_PATH}/constants`);
const { sendEmail } = require(`${SERVER_PATH}/mail`);
const { MAILTYPE } = require(`${SERVER_PATH}/mail/strings`);
const { getKitConfig, getKitSecrets, getKitCoins, isValidTierLevel } = require('./common');
const { isValidPassword } = require('./security');
const { getNodeLib } = require(`${SERVER_PATH}/init`);
const { all, reject } = require('bluebird');
const { Op } = require('sequelize');
const { paginationQuery, timeframeQuery, orderingQuery } = require('./database/helpers');
const { parse } = require('json2csv');
const flatten = require('flat');
const uuid = require('uuid/v4');
const { checkCaptcha, validatePassword, verifyOtpBeforeAction } = require('./security');

	/* Onboarding*/

const signUpUser = (email, password, opts = { referral: null }) => {
	if (!getKitConfig().new_user_is_activated) {
		return reject(new Error(SIGNUP_NOT_AVAILABLE));
	}

	if (!email || !isEmail(email)) {
		return reject(new Error(PROVIDE_VALID_EMAIL));
	}

	if (!isValidPassword(password)) {
		return reject(new Error(INVALID_PASSWORD));
	}

	return dbQuery.findOne('user', {
		where: { email: email.toLowerCase() },
		attributes: ['email']
	})
		.then((user) => {
			if (user) {
				throw new Error(USER_EXISTS);
			}
			return getModel('user').create({
				email,
				password,
				settings: INITIAL_SETTINGS()
			});
		})
		.then((user) => {
			return all([
				getVerificationCodeByUserId(user.id),
				user
			]);
		})
		.then(([ verificationCode, user ]) => {
			sendEmail(
				MAILTYPE.SIGNUP,
				email,
				verificationCode.code,
				{}
			);
			if (isString(opts.referral)) {
				checkAffiliation(opts.referral, user.id);
			}
			return user;
		});
};

const verifyUser = (email, code) => {
	return getModel('sequelize').transaction((transaction) => {
		return dbQuery.findOne('user',
			{ where: { email }, attributes: ['id', 'email', 'settings', 'network_id'] }
		)
			.then((user) => {
				return all([
					dbQuery.findOne('verification code',
						{
							where: { user_id: user.id },
							attributes: ['id', 'code', 'verified', 'user_id']
						}
					),
					user
				]);
			})
			.then(([ verificationCode, user ]) => {
				if (verificationCode.verified) {
					throw new Error(USER_IS_VERIFIED);
				}
				if (code !== verificationCode.code) {
					throw new Error(INVALID_VERIFICATION_CODE);
				}
				return all([
					user,
					getNodeLib().createUser(email),
					verificationCode.update({ verified: true }, { fields: ['verified'], returning: true, transaction })
				]);
			})
			.then(([ user, networkUser ]) => {
				return user.update({
					network_id: networkUser.id
				}, { fields: ['network_id'], returning: true, transaction });
			});
	});
};

const createUser = (
	email,
	password,
	opts = {
		role: 'user',
		id: null
	}
) => {
	return getModel('sequelize').transaction((transaction) => {
		return dbQuery.findOne('user', {
			where: { email }
		})
			.then((user) => {
				if (user) {
					throw new Error(USER_EXISTS);
				}
				const roles = {
					is_admin: false,
					is_supervisor: false,
					is_support: false,
					is_kyc: false,
					is_communicator: false
				};

				if (opts.role !== 'user') {
					const userRole = 'is_' + opts.role.toLowerCase();
					if (roles[userRole] === undefined) {
						throw new Error('Role does not exist');
					}
					each(roles, (value, key) => {
						if (key === userRole) {
							roles[key] = true;
						}
					});
				}

				const options = {
					email,
					password,
					settings: INITIAL_SETTINGS(),
					...roles
				};

				if (isNumber(opts.id)) {
					options.id = opts.id;
				}

				return getModel('user').create(options, { transaction });
			})
			.then((user) => {
				return all([
					user,
					getNodeLib().createUser(email)
				]);
			})
			.then(([ kitUser, networkUser ]) => {
				return kitUser.update({
					network_id: networkUser.id
				}, { returning: true, fields: ['network_id'], transaction });
			});
	})
		.then((user) => {
			return all([
				user,
				getModel('verification code').update(
					{ verified: true },
					{ where: { user_id: user.id }, fields: [ 'verified' ]}
				)
			]);
		})
		.then(([ user ]) => {
			sendEmail(
				MAILTYPE.WELCOME,
				user.email,
				{},
				user.settings
			);
			return;
		});
};

const createUserOnNetwork = (email) => {
	if (!isEmail(email)) {
		return reject(new Error(PROVIDE_VALID_EMAIL));
	}
	return getNodeLib().createUser(email);
};

const loginUser = (email, password, otp_code, captcha, ip, device, domain, origin, referer) => {
	return getUserByEmail(email.toLowerCase())
		.then((user) => {
			if (!user) {
				throw new Error(USER_NOT_FOUND);
			}
			if (user.verification_level === 0) {
				throw new Error(USER_NOT_VERIFIED);
			} else if (!user.activated) {
				throw new Error(USER_NOT_ACTIVATED);
			}
			return all([
				user,
				validatePassword(user.password, password)
			]);
		})
		.then(([ user, passwordIsValid ]) => {
			if (!passwordIsValid) {
				throw new Error(INVALID_CREDENTIALS);
			}

			if (!user.otp_enabled) {
				return all([ user, checkCaptcha(captcha, ip) ]);
			} else {
				return all([
					user,
					verifyOtpBeforeAction(user.id, otp_code).then((validOtp) => {
						if (!validOtp) {
							throw new Error(INVALID_OTP_CODE);
						} else {
							return checkCaptcha(captcha, ip);
						}
					})
				]);
			}
		})
		.then(([ user ]) => {
			if (ip) {
				registerUserLogin(user.id, ip, device, domain, origin, referer);
			}
			return user;
		});
};

const registerUserLogin = (
	userId,
	ip,
	opts = {
		device: null,
		domain: null,
		origin: null,
		referer: null
	}
) => {
	const login = {
		user_id: userId,
		ip
	};

	if (isString(opts.device)) {
		login.device = opts.device;
	}

	if (isString(opts.domain)) {
		login.domain = opts.domain;
	}

	if (isString(opts.origin)) {
		login.origin = opts.origin;
	}

	if (isString(opts.referer)) {
		login.referer = opts.referer;
	}

	return getModel('login').create(login);
};

	/* Public Endpoints*/


const getVerificationCodeByUserEmail = (email) => {
	return getUserByEmail(email)
		.then((user) => {
			if (!user) {
				throw new Error(USER_NOT_FOUND);
			}
			return getVerificationCodeByUserId(user.id);
		});
};

const getVerificationCodeByUserId = (user_id) => {
	return dbQuery.findOne('verification code', {
		where: { user_id },
		attributes: ['id', 'code', 'verified', 'user_id']
	});
};

const getUserByAffiliationCode = (affiliationCode) => {
	const code = affiliationCode.toUpperCase().trim();
	return dbQuery.findOne('user', {
		where: { affiliation_code: code },
		attributes: ['id', 'email', 'affiliation_code']
	});
};

const checkAffiliation = (affiliationCode, user_id) => {
	let discount = 0; // default discount rate in percentage
	return getUserByAffiliationCode(affiliationCode)
		.then((referrer) => {
			if (getKitSecrets().plugins.affiliation && getKitSecrets().plugins.affiliation.discount) {
				discount = getKitSecrets().plugins.affiliation.discount;
			}

			return getModel('affiliation').create({
				user_id,
				referer_id: referrer.id
			});
		})
		.then((affiliation) => {
			return getModel('user').update(
				{
					discount
				},
				{
					where: {
						id: affiliation.user_id
					},
					fields: ['discount']
				}
			);
		});
};

const getAffiliationCount = (userId) => {
	return getModel('affiliation').count({
		where: {
			referer_id: userId
		}
	});
};

const isValidUsername = (username) => {
	return /^[a-z0-9_]{3,15}$/.test(username);
};

/**
 *
 * @param {object} user - User object
 * @return {object}
 */
const omitUserFields = (user) => {
	return omit(user, OMITTED_USER_FIELDS);
};

const getAllUsers = () => {
	return dbQuery.findAll('user', {
		attributes: {
			exclude: OMITTED_USER_FIELDS
		}
	});
};

const getAllUsersAdmin = (opts = {
	id: null,
	search: null,
	pending: null,
	limit: null,
	page: null,
	order_by: null,
	order: null,
	start_date: null,
	end_date: null,
	format: null
}) => {
	const pagination = paginationQuery(opts.limit, opts.page);
	const timeframe = timeframeQuery(opts.start_date, opts.end_date);
	const ordering = orderingQuery(opts.order_by, opts.order);
	let query = {
		where: {
			created_at: timeframe
		}
	};
	if (opts.id || opts.search) {
		query.attributes = {
			exclude: ['balance', 'password', 'updated_at']
		};
		if (opts.id) {
			query.where.id = opts.id;
		} else {
			query.where = {
				$or: [
					{
						email: {
							[Op.like]: `%${opts.search}%`
						}
					},
					{
						username: {
							[Op.like]: `%${opts.search}%`
						}
					},
					{
						full_name: {
							[Op.like]: `%${opts.search}%`
						}
					},
					{
						phone_number: {
							[Op.like]: `%${opts.search}%`
						}
					},
					getModel('sequelize').literal(`id_data ->> 'number'='${opts.search}'`),
					...getKitCoins().map((coin) => getModel('sequelize').literal(`crypto_wallet ->> '${coin}'='${opts.search}'`))
				]
			};
		}
	} else if (isBoolean(opts.pending) && opts.pending) {
		query = {
			where: {
				$or: [
					getModel('sequelize').literal('bank_account @> \'[{"status":1}]\''),
					{
						id_data: {
							status: 1
						}
					},
					{
						activated: false
					}
				]
			},
			attributes: [
				'id',
				'email',
				'verification_level',
				'id_data',
				'bank_account',
				'activated'
			],
			order: [ordering]
		};
	} else {
		query = {
			where: {},
			attributes: {
				exclude: ['password', 'is_admin', 'is_support', 'is_supervisor', 'is_kyc', 'is_communicator']
			},
			order: [ordering]
		};
	}

	if (!opts.format) {
		query = {...query, ...pagination};
	} else if (isBoolean(opts.pending) && !opts.pending) {
		query.attributes.exclude.push('settings');
	}

	return dbQuery.findAndCountAllWithRows('user', query)
		.then(async ({ count, data }) => {
			if (opts.id || opts.search) {
				if (count === 0) {
					// Need to throw error if query was for one user and the user is not found
					const error = new Error(USER_NOT_FOUND);
					error.status = 404;
					throw error;
				} else {
					const userNetworkData = await getNodeLib().getUser(data[0].network_id);
					data[0].balance = userNetworkData.balance;
					data[0].crypto_wallet = userNetworkData.crypto_wallet;
					return { count, data };
				}
			}
			return { count, data };
		})
		.then(async (users) => {
			if (opts.format) {
				if (users.data.length === 0) {
					throw new Error(NO_DATA_FOR_CSV);
				}
				const flatData = users.data.map((user) => {
					let crypto_wallet;
					let id_data;
					if (user.crypto_wallet) {
						crypto_wallet = user.crypto_wallet;
						user.crypto_wallet = {};
					}
					if (user.id_data) {
						id_data = user.id_data;
						user.id_data = {};
					}
					const result = flatten(user, { safe: true });
					if (crypto_wallet) result.crypto_wallet = crypto_wallet;
					if (id_data) result.id_data = id_data;
					return result;
				});
				const csv = parse(flatData, Object.keys(flatData[0]));
				return csv;
			} else {
				return users;
			}
		});
};

const getUser = (opts = {}, rawData = true, networkData = false) => {
	if (!opts.email && !opts.kit_id && !opts.network_id) {
		return reject(new Error(PROVIDE_USER_CREDENTIALS));
	}

	const where = {};
	if (opts.email) {
		where.email = opts.email;
	} else if (opts.kit_id) {
		where.id = opts.kit_id;
	} else {
		where.network_id = opts.network_id;
	}

	return dbQuery.findOne('user', {
		where,
		raw: rawData
	})
		.then(async (user) => {
			if (networkData) {
				if (rawData) {
					const networkData = await getNodeLib().getUser(user.network_id);
					user.balance = networkData.balance;
					user.crypto_wallet = networkData.crypto_wallet;
				} else {
					const networkData = await getNodeLib().getUser(user.network_id);
					user.dataValues.balance = networkData.balance;
					user.dataValues.crypto_wallet = networkData.crypto_wallet;
				}
			}
			return user;
		});
};

const getUserNetwork = (networkId) => {
	return getNodeLib().getUser(networkId);
};

const getUsersNetwork = () => {
	return getNodeLib().getUsers();
};

const getUserByEmail = (email, rawData = true, networkData = false) => {
	if (!email || !isEmail(email)) {
		return reject(new Error(PROVIDE_VALID_EMAIL));
	}
	return getUser({ email }, rawData, networkData);
};

const getUserByKitId = (kit_id, rawData = true, networkData = false) => {
	if (!kit_id) {
		return reject(new Error(PROVIDE_KIT_ID));
	}
	return getUser({ kit_id }, rawData, networkData);
};

const getUserTier = (user_id) => {
	return getUser({ user_id }, true)
		.then((user) => {
			if (!user) {
				throw new Error(USER_NOT_FOUND);
			}
			if (user.verification_level < 1) {
				throw new Error('User is not verified');
			}
			return dbQuery.findOne('tier', {
				where: {
					id: user.verification_level
				},
				raw: true
			});
		});
};

const getUserByNetworkId = (network_id, rawData = true, networkData = false) => {
	if (!network_id) {
		return reject(new Error(PROVIDE_NETWORK_ID));
	}
	return getUser({ network_id }, rawData, networkData);
};

const freezeUserById = (userId) => {
	if (userId === 1) {
		return reject(new Error(CANNOT_DEACTIVATE_ADMIN));
	}
	return getUserByKitId(userId, false)
		.then((user) => {
			if (!user) {
				throw new Error(USER_NOT_FOUND);
			}
			if (!user.activated) {
				throw new Error(USER_ALREADY_DEACTIVATED);
			}
			return user.update({ activated: false }, { fields: ['activated'], returning: true });
		})
		.then((user) => {
			publisher.publish(CONFIGURATION_CHANNEL, JSON.stringify({type: 'freezeUser', data: user.id }));
			sendEmail(
				MAILTYPE.USER_DEACTIVATED,
				user.email,
				{
					type: 'deactivated'
				},
				user.settings
			);
			return user;
		});
};

const freezeUserByEmail = (email) => {
	return getUserByEmail(email, false)
		.then((user) => {
			if (!user) {
				throw new Error(USER_NOT_FOUND);
			}
			if (user.id === 1) {
				throw new Error(CANNOT_DEACTIVATE_ADMIN);
			}
			if (!user.activated) {
				throw new Error(USER_ALREADY_DEACTIVATED);
			}
			return user.update({ activated: false }, { fields: ['activated'], returning: true });
		})
		.then((user) => {
			publisher.publish(CONFIGURATION_CHANNEL, JSON.stringify({type: 'freezeUser', data: user.id }));
			sendEmail(
				MAILTYPE.USER_DEACTIVATED,
				user.email,
				{
					type: 'deactivated'
				},
				user.settings
			);
			return user;
		});
};

const unfreezeUserById = (userId) => {
	return getUserByKitId(userId, false)
		.then((user) => {
			if (!user) {
				throw new Error(USER_NOT_FOUND);
			}
			if (user.activated) {
				throw new Error(USER_NOT_DEACTIVATED);
			}
			return user.update({ activated: true }, { fields: ['activated'], returning: true });
		})
		.then((user) => {
			publisher.publish(CONFIGURATION_CHANNEL, JSON.stringify({type: 'unfreezeUser', data: user.id }));
			sendEmail(
				MAILTYPE.USER_DEACTIVATED,
				user.email,
				{
					type: 'activated'
				},
				user.settings
			);
			return user;
		});
};

const unfreezeUserByEmail = (email) => {
	return getUserByEmail(email, false)
		.then((user) => {
			if (!user) {
				throw new Error(USER_NOT_FOUND);
			}
			if (user.activated) {
				throw new Error(USER_NOT_DEACTIVATED);
			}
			return user.update({ activated: true }, { fields: ['activated'], returning: true  });
		})
		.then((user) => {
			publisher.publish(CONFIGURATION_CHANNEL, JSON.stringify({type: 'unfreezeUser', data: user.id }));
			sendEmail(
				MAILTYPE.USER_DEACTIVATED,
				user.email,
				{
					type: 'activated'
				},
				user.settings
			);
			return user;
		});
};

const getUserRole = (opts = {}) => {
	return getUser(opts, true)
		.then((user) => {
			if (!user) {
				throw new Error(USER_NOT_FOUND);
			}
			if (user.is_admin) {
				return 'admin';
			} else if (user.is_supervisor) {
				return 'supervisor';
			} else if (user.is_support) {
				return 'support';
			} else if (user.is_kyc) {
				return 'kyc';
			} else if (user.is_communicator) {
				return 'communicator';
			} else {
				return 'user';
			}
		});
};

const updateUserRole = (user_id, role) => {
	if (user_id === 1) {
		return reject(new Error(CANNOT_CHANGE_ADMIN_ROLE));
	}
	return dbQuery.findOne('user', {
		where: {
			id: user_id
		},
		attributes: [
			'id',
			'email',
			'is_admin',
			'is_support',
			'is_supervisor',
			'is_kyc',
			'is_communicator'
		]
	})
		.then((user) => {
			if (!user) {
				throw new Error(USER_NOT_FOUND);
			}
			const roles = pick(
				user.dataValues,
				'is_admin',
				'is_supervisor',
				'is_support',
				'is_kyc',
				'is_communicator'
			);

			const roleChange = 'is_' + role.toLowerCase();

			if (roles[roleChange]) {
				throw new Error (`User already has role ${role}`);
			}

			each(roles, (value, key) => {
				if (key === roleChange) {
					roles[key] = true;
				} else {
					roles[key] = false;
				}
			});

			return all([user, roles]);
		})
		.then(([user, roles]) => {
			return user.update(
				roles,
				{ fields: ['is_admin', 'is_support', 'is_supervisor', 'is_kyc', 'is_communicator'], returning: true }
			);
		})
		.then((user) => {
			const result = pick(
				user,
				'id',
				'email',
				'is_admin',
				'is_support',
				'is_supervisor',
				'is_kyc',
				'is_communicator'
			);
			return result;
		});
};

const DEFAULT_SETTINGS = {
	language: getKitConfig().defaults.language,
	orderConfirmationPopup: true
};

const joinSettings = (userSettings = {}, newSettings = {}) => {
	const joinedSettings = {};
	SETTING_KEYS.forEach((key) => {
		if (has(newSettings, key)) {
			joinedSettings[key] = newSettings[key];
		} else if (has(userSettings, key)) {
			joinedSettings[key] = userSettings[key];
		} else {
			joinedSettings[key] = DEFAULT_SETTINGS[key];
		}
	});
	return joinedSettings;
};

const updateUserSettings = (userOpts = {}, settings = {}, rawData = true) => {
	return getUser(userOpts, false)
		.then((user) => {
			if (!user) {
				throw new Error(USER_NOT_FOUND);
			}
			if (Object.keys(settings).length > 0) {
				settings = joinSettings(user.dataValues.settings, settings);
			}
			return user.update({ settings }, {
				fields: [
					'settings'
				],
				returning: true,
				raw: rawData
			});
		})
		.then((user) => {
			return user;
		});
};

const INITIAL_SETTINGS = () => {
	return {
		notification: {
			popup_order_confirmation: true,
			popup_order_completed: true,
			popup_order_partially_filled: true
		},
		interface: {
			order_book_levels: 10,
			theme: getKitConfig().defaults.theme
		},
		language: getKitConfig().defaults.language,
		audio: {
			order_completed: true,
			order_partially_completed: true,
			public_trade: false
		},
		risk: {
			order_portfolio_percentage: DEFAULT_ORDER_RISK_PERCENTAGE
		},
		chat: {
			set_username: false
		}
	};
};

const getUserEmailByVerificationCode = (code) => {
	return dbQuery.findOne('verification code', {
		where: { code },
		attributes: ['id', 'code', 'verified', 'user_id']
	})
		.then((verificationCode) => {
			if (!verificationCode) {
				throw new Error(INVALID_VERIFICATION_CODE);
			} else if (verificationCode.verified) {
				throw new Error(VERIFICATION_CODE_USED);
			}
			return dbQuery.findOne('user', {
				where: { id: verificationCode.user_id },
				attributes: ['email']
			});
		})
		.then((user) => {
			return user.email;
		});
};

const updateUserNote = (userId, note) => {
	return getUserByKitId(userId, false)
		.then((user) => {
			if (!user) {
				throw new Error(USER_NOT_FOUND);
			}
			return user.update({ note }, { fields: ['note']});
		});
};

const changeUserVerificationLevelById = (userId, newLevel, domain) => {
	if (!isValidTierLevel(newLevel)) {
		return reject(new Error(INVALID_VERIFICATION_LEVEL(newLevel)));
	}

	let currentVerificationLevel = 0;
	return getUserByKitId(userId, false)
		.then((user) => {
			if (!user) {
				throw new Error(USER_NOT_FOUND);
			}
			if (user.verification_level === 0) {
				throw new Error(ACCOUNT_NOT_VERIFIED);
			}
			currentVerificationLevel = user.verification_level;
			return user.update(
				{ verification_level: newLevel },
				{ fields: ['verification_level'], returning: true }
			);
		})
		.then((user) => {
			if (currentVerificationLevel === 1 && user.verification_level === 2) {
				sendEmail(
					MAILTYPE.ACCOUNT_VERIFY,
					user.email,
					undefined,
					user.settings,
					domain
				);
			} else if (
				currentVerificationLevel < user.verification_level &&
				currentVerificationLevel > 1
			) {
				sendEmail(
					MAILTYPE.ACCOUNT_UPGRADE,
					user.email,
					user.verification_level,
					user.settings,
					domain
				);
			}
			return;
		});
};

const deactivateUserOtpById = (userId) => {
	return getUserByKitId(userId, false)
		.then((user) => {
			if (!user) {
				throw new Error(USER_NOT_FOUND);
			}
			return user.update(
				{ otp_enabled: false },
				{ fields: [ 'otp_enabled' ]}
			);
		});
};

const toggleFlaggedUserById = (userId) => {
	return getUserByKitId(userId, false)
		.then((user) => {
			if (!user) {
				throw new Error(USER_NOT_FOUND);
			}
			return user.update(
				{ flagged: !user.flagged },
				{ fields: ['flagged'] }
			);
		});
};

const getUserLogins = (opts = {
	userId: null,
	limit: null,
	page: null,
	orderBy: null,
	order: null,
	startDate: null,
	endDate: null,
	format: null
}) => {
	const pagination = paginationQuery(opts.limit, opts.page);
	const timeframe = timeframeQuery(opts.startDate, opts.endDate);
	const ordering = orderingQuery(opts.orderBy, opts.order);
	let options = {
		where: {
			timestamp: timeframe
		},
		attributes: {
			exclude: ['id', 'origin', 'referer']
		},
		order: [ordering]
	};
	if (!opts.format) {
		options = { ...options, ...pagination};
	}

	if (opts.userId) options.where.user_id = opts.userId;

	return dbQuery.findAndCountAllWithRows('login', options)
		.then((logins) => {
			if (opts.format) {
				if (logins.data.length === 0) {
					throw new Error(NO_DATA_FOR_CSV);
				}
				const csv = parse(logins.data, Object.keys(logins.data[0]));
				return csv;
			} else {
				return logins;
			}
		});
};

const bankComparison = (bank1, bank2, description) => {
	let difference = [];
	let note = '';
	if (bank1.length === bank2.length) {
		note = 'bank info updated';
		difference = differenceWith(bank1, bank2, isEqual);
	} else if (bank1.length > bank2.length) {
		note = 'bank removed';
		difference = differenceWith(bank1, bank2, isEqual);
	} else if (bank1.length < bank2.length) {
		note = 'bank added';
		difference = differenceWith(bank2, bank1, isEqual);
	}

	// bank data is changed
	if (difference.length > 0) {
		description.note = note;
		description.new.bank_account = bank2;
		description.old.bank_account = bank1;
	}
	return description;
};

const createAuditDescription = (userId, prevData = {}, newData = {}) => {
	let description = {
		userId,
		note: `Change in user ${userId} information`,
		old: {},
		new: {}
	};
	for (const key in newData) {
		if (USER_FIELD_ADMIN_LOG.includes(key)) {
			let prevRecord = prevData[key] || 'empty';
			let newRecord = newData[key] || 'empty';
			if (key === 'bank_account') {
				description = bankComparison(
					prevData.bank_account,
					newData.bank_account,
					description
				);
			} else if (key === 'id_data') {
				ID_FIELDS.forEach((field) => {
					if (newRecord[field] != prevRecord[field]) {
						description.old[field] = prevRecord[field];
						description.new[field] = newRecord[field];
					}
				});
			} else if (key === 'address') {
				ADDRESS_FIELDS.forEach((field) => {
					if (prevRecord[field] != newRecord[field]) {
						description.old[field] = prevRecord[field];
						description.new[field] = newRecord[field];
					}
				});
			} else {
				if (prevRecord.toString() != newRecord.toString()) {
					description.old[key] = prevRecord;
					description.new[key] = newRecord;
				}
			}
		}
	}
	return description;
};

const createAudit = (adminId, event, ip, opts = {
	userId: null,
	prevUserData: null,
	newUserData: null,
	domain: null
}) => {
	const options = {
		admin_id: adminId,
		event,
		description: createAuditDescription(opts.userId, opts.prevUserData, opts.newUserData),
		ip,
	};
	if (opts.domain) {
		options.domain = opts.domain;
	}
	return getModel('audit').create({
		admin_id: adminId,
		event,
		description: createAuditDescription(opts.userId, opts.prevUserData, opts.newUserData),
		ip
	});
};

const getUserAudits = (opts = {
	userId: null,
	limit: null,
	page: null,
	orderBy: null,
	order: null,
	startDate: null,
	endDate: null,
	format: null
}) => {
	const pagination = paginationQuery(opts.limit, opts.page);
	const timeframe = timeframeQuery(opts.startDate, opts.endDate);
	const ordering = orderingQuery(opts.orderBy, opts.order);
	let options = {
		where: {
			timestamp: timeframe
		},
		order: [ordering]
	};

	if (!opts.format) {
		options = { ...options, ...pagination };
	}

	if (isNumber(opts.userId)) options.where.description = getModel('sequelize').literal(`description ->> 'user_id' = '${opts.userId}'`);

	return dbQuery.findAndCountAllWithRows('audit', options)
		.then((audits) => {
			if (opts.format) {
				if (audits.data.length === 0) {
					throw new Error(NO_DATA_FOR_CSV);
				}
				const flatData = audits.data.map((audit) => flatten(audit, { maxDepth: 2 }));
				const csv = parse(flatData, AUDIT_KEYS);
				return csv;
			} else {
				return audits;
			}
		});
};

const checkUsernameIsTaken = (username) => {
	return getModel('user').count({ where: { username }})
		.then((count) => {
			if (count > 0) {
				throw new Error(USERNAME_IS_TAKEN);
			} else {
				return true;
			}
		});
};

const setUsernameById = (userId, username) => {
	if (!isValidUsername(username)) {
		return reject(new Error(INVALID_USERNAME));
	}
	return getUserByKitId(userId, false)
		.then((user) =>{
			if (!user) {
				throw new Error(USER_NOT_FOUND);
			}
			if (user.settings.chat.set_username) {
				throw new Error(USERNAME_CANNOT_BE_CHANGED);
			}
			return all([ user, checkUsernameIsTaken(username) ]);
		})
		.then(([ user ]) => {
			return user.update(
				{
					username,
					settings: {
						...user.settings,
						chat: {
							set_username: true
						}
					}
				},
				{ fields: ['username', 'settings'] }
			);
		});
};

const createUserCryptoAddressByNetworkId = (networkId, crypto) => {
	return getNodeLib().createUserCryptoAddress(networkId, crypto);
};

const createUserCryptoAddressByKitId = (kitId, crypto) => {
	return getUserByKitId(kitId)
		.then((user) => {
			if (!user) {
				throw new Error(USER_NOT_FOUND);
			}
			return getNodeLib().createUserCryptoAddress(user.network_id, crypto);
		});
};

const getUserStatsByKitId = (userId) => {
	return getUserByKitId(userId)
		.then((user) => {
			if (!user) {
				throw new Error(USER_NOT_FOUND);
			}
			return getNodeLib().getUserStats(user.network_id);
		});
};

const getUserStatsByNetworkId = (networkId) => {
	return getNodeLib().getUserStats(networkId);
};

const getExchangeOperators = (opts = {
	limit: null,
	page: null,
	orderBy: null,
	order: null
}) => {
	const pagination = paginationQuery(opts.limit, opts.page);
	const ordering = orderingQuery(opts.orderBy, opts.order);

	const options = {
		where: {
			[Op.or]: [
				{ is_admin: true },
				{ is_supervisor: true },
				{ is_support: true },
				{ is_kyc: true },
				{ is_communicator: true }
			]
		},
		attributes: ['id', 'email', 'is_admin', 'is_supervisor', 'is_support', 'is_kyc', 'is_communicator'],
		order: [ordering],
		...pagination
	};

	return dbQuery.findAndCountAllWithRows('user', options);
};

const inviteExchangeOperator = (invitingEmail, email, role) => {
	const roles = {
		is_admin: false,
		is_supervisor: false,
		is_support: false,
		is_kyc: false,
		is_communicator: false
	};

	if (!email || !isEmail(email)) {
		return reject(new Error(PROVIDE_VALID_EMAIL));
	}

	role = role.toLowerCase();
	const roleToUpdate = `is_${role}`;

	if (role === 'user') {
		return reject(new Error('Must invite user as an operator role'));
	} else {
		if (roles[roleToUpdate] === undefined) {
			return reject(new Error('Invalid role'));
		} else {
			roles[roleToUpdate] = true;
		}
	}

	const tempPassword = uuid();

	return getModel('sequelize').transaction((transaction) => {
		return getModel('user').findOrCreate({
			defaults: {
				email,
				password: tempPassword,
				...roles,
				settings: INITIAL_SETTINGS()
			},
			where: { email },
			transaction
		})
			.then(async ([ user, created ]) => {
				if (created) {
					const networkUser = await getNodeLib().createUser(email);
					return all([
						user.update(
							{ network_id: networkUser.id },
							{ returning: true, fields: ['network_id'], transaction }
						),
						created
					]);
				} else {
					if (user.is_admin || user.is_supervisor || user.is_support || user.is_kyc || user.is_communicator) {
						throw new Error('User is already an operator');
					}
					return all([
						user.update({ ...roles }, { returning: true, fields: Object.keys(roles), transaction }),
						created
					]);
				}
			});
	})
		.then(async ([ user, created ]) => {
			if (created) {
				await getModel('verification code').update(
					{ verified: true },
					{ where: { user_id: user.id }, fields: [ 'verified' ]}
				);
			}
			sendEmail(
				MAILTYPE.INVITED_OPERATOR,
				user.email,
				{
					invitingEmail,
					created,
					password: created ? tempPassword : undefined,
					role
				},
				user.settings
			);
			return;
		});
};

module.exports = {
	loginUser,
	getUserTier,
	createUser,
	getUserByEmail,
	getUserByKitId,
	getUserByNetworkId,
	freezeUserById,
	freezeUserByEmail,
	unfreezeUserById,
	unfreezeUserByEmail,
	getAllUsers,
	getUserRole,
	updateUserSettings,
	omitUserFields,
	signUpUser,
	registerUserLogin,
	verifyUser,
	getVerificationCodeByUserEmail,
	getUserEmailByVerificationCode,
	getAllUsersAdmin,
	updateUserRole,
	updateUserNote,
	changeUserVerificationLevelById,
	deactivateUserOtpById,
	toggleFlaggedUserById,
	getUserLogins,
	getUserAudits,
	setUsernameById,
	getAffiliationCount,
	isValidUsername,
	createUserCryptoAddressByKitId,
	createAudit,
	getUserStatsByKitId,
	getExchangeOperators,
	inviteExchangeOperator,
	createUserOnNetwork,
	getUserNetwork,
	getUsersNetwork,
	createUserCryptoAddressByNetworkId,
	getUserStatsByNetworkId,
	getVerificationCodeByUserId
};