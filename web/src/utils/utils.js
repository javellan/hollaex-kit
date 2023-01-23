import moment from 'moment';
import momentJ from 'moment-jalaali';
import math from 'mathjs';
import _toLower from 'lodash/toLower';
import {
	TOKEN_TIME,
	TIMESTAMP_FORMAT,
	TIMESTAMP_FORMAT_FA,
	DEFAULT_TIMESTAMP_FORMAT,
	AUDIOS,
	NETWORK_API_URL,
} from '../config/constants';
import { getLanguage } from './string';
import _orderBy from 'lodash/orderBy';
import { getDashToken } from './token';
import axios from 'axios';

const bitcoin = {
	COIN: 100000000,
	PRECISION: 8,
	DUST: 2730,
	BASE_FEE: 10000,
};

const CHART_RESOLUTION_KEY = 'chart_resolution_data';

/**
 * convert a BTC value to Satoshi
 *
 * @param btc   float       BTC value
 * @returns int             Satoshi value (int)
 */
bitcoin.toSatoshi = (btc) => {
	return parseInt((btc * bitcoin.COIN).toFixed(0), 10);
};

/**
 * convert a Satoshi value to BTC
 *
 * @param satoshi   int     Satoshi value
 * @returns {string}        BTC value (float)
 */
bitcoin.toBTC = (satoshi) => {
	return (satoshi / bitcoin.COIN).toFixed(bitcoin.PRECISION);
};

export default bitcoin;

export const checkUserSessionExpired = (loginTime) => {
	const currentTime = Date.now();

	return currentTime - loginTime > TOKEN_TIME;
};

export const getFormattedBOD = (date, format = DEFAULT_TIMESTAMP_FORMAT) => {
	if (getLanguage() === 'fa') {
		return formatTimestampFarsi(date, format);
	}
	return formatTimestampGregorian(date, format);
};

export const getFormatTimestamp = (date, format) => {
	if (getLanguage() === 'fa') {
		return formatTimestampFarsi(date, format);
	}
	return formatTimestampGregorian(date, format);
};

export const formatTimestamp = (date, format) => {
	return formatTimestampGregorian(date, format);
};

export const formatTimestampGregorian = (date, format = TIMESTAMP_FORMAT) =>
	moment(date).format(format);

export const formatTimestampFarsi = (date, format = TIMESTAMP_FORMAT_FA) =>
	momentJ(date).format(format);

export const getDecimals = (value = 0) => {
	let result = math.format(math.number(value), { notation: 'fixed' });
	return value % 1
		? result.toString().split('.')[1]
			? result.toString().split('.')[1].length
			: 0
		: 0;
};

export const isBlockchainTx = (transactionId) => {
	return transactionId.indexOf('-') === -1 ? true : false;
};

export const constructSettings = (state = {}, settings) => {
	let settingsData = { ...state };
	if (settings.notification) {
		settingsData.notification = {
			...settingsData.notification,
			...settings.notification,
		};
	}
	if (settings.interface) {
		settingsData.interface = {
			...settingsData.interface,
			...settings.interface,
		};
	}
	if (settings.audio) {
		settingsData.audio = { ...settingsData.settingsData, ...settings.audio };
	}
	if (settings.risk) {
		settingsData.risk = { ...settingsData.risk, ...settings.risk };
	}
	if (settings.chat) {
		settingsData.chat = { ...settingsData.chat, ...settings.chat };
	}
	if (settings.language) {
		settingsData.language = settings.language;
	}
	if (settings.app) {
		settingsData.apps = settings.app;
	}

	// ToDo: need to these code after end point update.
	if (
		settings.popup_order_confirmation ||
		settings.popup_order_confirmation === false
	) {
		settingsData.notification.popup_order_confirmation =
			settings.popup_order_confirmation;
	}
	if (
		settings.popup_order_completed ||
		settings.popup_order_completed === false
	) {
		settingsData.notification.popup_order_completed =
			settings.popup_order_completed;
	}
	if (
		settings.popup_order_partially_filled ||
		settings.popup_order_partially_filled === false
	) {
		settingsData.notification.popup_order_partially_filled =
			settings.popup_order_partially_filled;
	}

	if (settings.theme) {
		settingsData.interface.theme = settings.theme;
	}
	if (settings.order_book_levels) {
		settingsData.interface.order_book_levels = settings.order_book_levels;
	}

	if (settings.order_completed || settings.order_completed === false) {
		settingsData.audio.order_completed = settings.order_completed;
	}
	if (
		settings.order_partially_completed ||
		settings.order_partially_completed === false
	) {
		settingsData.audio.order_partially_completed =
			settings.order_partially_completed;
	}
	if (settings.public_trade || settings.public_trade === false) {
		settingsData.audio.public_trade = settings.public_trade;
	}

	if (settings.order_portfolio_percentage) {
		settingsData.risk.order_portfolio_percentage =
			settings.order_portfolio_percentage;
	}
	if (settings.popup_warning || settings.popup_warning === false) {
		settingsData.risk.popup_warning = settings.popup_warning;
	}

	if (settings.set_username) {
		settingsData.chat.set_username = settings.set_username;
	}
	if (settings.theme) {
		settingsData.theme = settings.theme;
	}

	return settingsData;
};

export const playBackgroundAudioNotification = (
	type = '',
	audioSettings = { audio: {} }
) => {
	let audioSetup = {
		all: true,
		public_trade: false,
		order_partially_completed: true,
		order_placed: true,
		order_canceled: true,
		order_completed: true,
		click_amounts: true,
		get_quote_quick_trade: true,
		quick_trade_success: true,
		quick_trade_timeout: true,
		...audioSettings.audio,
	};
	let audioFile = '';
	switch (type) {
		case 'orderbook_market_order':
		case 'filled':
			if (audioSetup.order_completed) {
				audioFile = AUDIOS.ORDER_COMPLETED;
			} else {
				audioFile = '';
			}
			break;
		case 'pfilled':
			if (audioSetup.order_partially_completed) {
				audioFile = AUDIOS.ORDER_PARTIALLY_COMPLETED;
			} else {
				audioFile = '';
			}
			break;
		case 'orderbook_field_update':
			if (audioSetup.click_amounts) {
				audioFile = AUDIOS.ORDERBOOK_FIELD_UPDATE;
			} else {
				audioFile = '';
			}
			break;
		case 'orderbook_limit_order':
			if (audioSetup.order_placed) {
				audioFile = AUDIOS.ORDERBOOK_LIMIT_ORDER;
			} else {
				audioFile = '';
			}
			break;
		case 'public_trade':
			if (audioSetup.public_trade) {
				audioFile = AUDIOS.PUBLIC_TRADE_NOTIFICATION;
			} else {
				audioFile = '';
			}
			break;
		case 'cancel_order':
			if (audioSetup.order_canceled) {
				audioFile = AUDIOS.CANCEL_ORDER;
			} else {
				audioFile = '';
			}
			break;
		case 'quick_trade_complete':
			if (audioSetup.quick_trade_success) {
				audioFile = AUDIOS.QUICK_TRADE_COMPLETE;
			} else {
				audioFile = '';
			}
			break;
		case 'review_quick_trade_order':
			if (audioSetup.get_quote_quick_trade) {
				audioFile = AUDIOS.REVIEW_QUICK_TRADE_ORDER;
			} else {
				audioFile = '';
			}
			break;
		case 'time_out_quick_trade':
			if (audioSetup.quick_trade_timeout) {
				audioFile = AUDIOS.TIME_OUT_QUICK_TRADE;
			} else {
				audioFile = '';
			}
			break;
		default:
	}
	if (audioSetup.all === false) {
		audioFile = '';
	}
	const audio = new Audio(audioFile);
	if (audioFile) audio.play();
};

export const setChartResolution = (resolution, pair) => {
	try {
		const prevObj = localStorage.getItem(CHART_RESOLUTION_KEY);
		let prevObjData = prevObj ? JSON.parse(prevObj) : {};
		prevObjData[pair] = resolution;
		localStorage.setItem(CHART_RESOLUTION_KEY, JSON.stringify(prevObjData));
	} catch (err) {
		console.log(err);
	}
};

export const getChartResolution = () => {
	try {
		const resolutionData = localStorage.getItem(CHART_RESOLUTION_KEY);
		return resolutionData ? JSON.parse(resolutionData) : {};
	} catch (err) {
		console.log(err);
	}
};

export const handleUpgrade = (info = {}) => {
	if (
		_toLower(info.plan) !== 'crypto' &&
		_toLower(info.plan) !== 'fiat' &&
		_toLower(info.plan) !== 'boost' &&
		_toLower(info.type) !== 'enterprise'
	) {
		return true;
	} else {
		return false;
	}
};

export const handleFiatUpgrade = (info = {}) => {
	if (_toLower(info.plan) !== 'fiat' && _toLower(info.plan) !== 'boost') {
		return true;
	} else {
		return false;
	}
};

export const constractPaymentOption = (paymentsData) => {
	const tempData = [];
	Object.keys(paymentsData).forEach((key) => {
		tempData.push({ name: key, ...paymentsData[key] });
	});
	return _orderBy(tempData, ['orderBy'], ['asc']);
};

export const _FetchDash = (
	url,
	method,
	data = null,
	baseURL = NETWORK_API_URL
) => {
	const tempToken =
		'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOnsiaWQiOjI4MjYsImVtYWlsIjoicmFtKzQyQGJpdGhvbGxhLmNvbSJ9LCJzY29wZXMiOlsidXNlciIsIm9wZXJhdG9yIl0sImlwIjoiNTkuOTMuMzIuMTI3IiwiaXNzIjoiYml0aG9sbGEuY29tIiwiaWF0IjoxNjc0MTE0OTkzLCJleHAiOjE2NzQyMDEzOTN9.Ob7Ep6MA-jj06QlpLeUYC6DjxOSxgwmUk8fLX6d_TBA';
	return new Promise((resolve, reject) => {
		const ID_TOKEN = getDashToken();
		if (url.includes('plan') || url.includes('pay')) {
			axios.defaults.headers.post['Content-Type'] = 'application/json';
			axios.defaults.headers.common['Authorization'] = `Bearer ${tempToken}`;
		} else if (ID_TOKEN) {
			console.log('ID_TOKEN', ID_TOKEN);
			axios.defaults.headers.post['Content-Type'] = 'application/json';
			axios.defaults.headers.common['Authorization'] = `Bearer ${ID_TOKEN}`;
		}
		const config = {
			baseURL,
			method,
			url,
		};
		if (data) {
			config.data = data;
		}
		axios(config)
			.then((res) => {
				resolve(res);
			})
			.catch((err) => {
				if (err.response === undefined) {
					reject({
						data: {
							message: 'Request Failed',
						},
					});
				}
				reject(err.response);
			});
	});
};
