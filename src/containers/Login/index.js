import React, { Component } from 'react';
import classnames from 'classnames';
import { connect } from 'react-redux';
import { SubmissionError, change } from 'redux-form';
import { bindActionCreators } from 'redux';
import { Link } from 'react-router';
import { isMobile } from 'react-device-detect';

import { performLogin, storeLoginResult, setLogoutMessage } from '../../actions/authAction';
import LoginForm, { FORM_NAME } from './LoginForm';
import TermsOfService from '../TermsOfService';
import DepositFunds from '../TermsOfService/DepositFunds';
import { Dialog, OtpForm, IconTitle, Notification } from '../../components';
import { NOTIFICATIONS } from '../../actions/appActions';
import { errorHandler } from '../../components/OtpForm/utils';
import {
	HOLLAEX_LOGO,
	HOLLAEX_LOGO_BLACK,
	FLEX_CENTER_CLASSES,
	ICONS
} from '../../config/constants';

import STRINGS from '../../config/localizedStrings';

const BottomLink = () => (
	<div className={classnames('f-1', 'link_wrapper')}>
		{STRINGS.LOGIN.NO_ACCOUNT}
		<Link to="/signup" className={classnames('blue-link')}>
			{STRINGS.LOGIN.CREATE_ACCOUNT}
		</Link>
	</div>
);

class Login extends Component {
	state = {
		values: {},
		otpDialogIsOpen: false,
		logoutDialogIsOpen: false,
		termsDialogIsOpen: false,
		depositDialogIsOpen: false,
		token: ''
	};
	
	componentDidMount() {
		if (this.props.logoutMessage) {
			this.setState({ logoutDialogIsOpen: true });
		}
	}

	componentWillReceiveProps(nextProps) {
		if (
			nextProps.logoutMessage &&
			nextProps.logoutMessage !== this.props.logoutMessage
		) {
			this.setState({ logoutDialogIsOpen: true });
		}
	}

	componentWillUnmount() {
		this.props.setLogoutMessage();
	}

	redirectToHome = () => {
		this.props.router.replace('/account');
	};

	redirectToResetPassword = () => {
		this.props.router.replace('/reset-password');
	};

	redirectToService = (url) => {
		window.location.href = `https://${url}`;
	};

	getServiceParam = () => {
		let service = '';
		if (this.props.location
			&& this.props.location.query
			&& this.props.location.query.service) {
			service = this.props.location.query.service;
		} else if (window.location
			&& window.location.search
			&& window.location.search.includes('service')) {
			service = window.location.search.split('?service=')[1];
		}
		return service;
	}

	checkLogin = () => {
		const termsAccepted = localStorage.getItem('termsAccepted');
		if (!termsAccepted) {
			this.setState({ termsDialogIsOpen: true });
			// this.props.router.replace('/terms');
		} else {
			this.redirectToHome();
		}
	}

	onSubmitLogin = (values) => {
		const service = this.getServiceParam();
		if (service) {
			values.service = service;
		}
		return performLogin(values)
			.then((res) => {
				if (res.data.token)
					this.setState({ token: res.data.token });
				if (res.data && res.data.callbackUrl)
					this.redirectToService(res.data.callbackUrl);
				else
					this.checkLogin();
			})
			.catch((err) => {
				console.log('err', err);
				const _error = err.response && err.response.data
					? err.response.data.message
					: err.message;

				let error = {};

				setTimeout(() => {
					this.props.change(FORM_NAME, 'captcha', '');
				}, 5000);

				if (_error.toLowerCase().indexOf('otp') > -1) {
					this.setState({ values, otpDialogIsOpen: true });
					error._error = STRINGS.VALIDATIONS.OTP_LOGIN;
				} else {
					if (_error === 'User is not activated') {
						error._error = (
							<div style={{ color: 'black' }}>
								Account approval is required to access the demo exchange.<br />
								Please contact us at{' '}
								<a
									style={{ color: 'blue' }}
									href="mailto:support@bitholla.com?Subject=Approval%20request"
									target="_top"
								>
									support@bitholla.com
								</a>{' '}
								with your use case for approval access
							</div>
						);
					} else {
						error._error = _error;
					}
					throw new SubmissionError(error);
				}
			});
	};

	onSubmitLoginOtp = (values) => {
		return performLogin(
			Object.assign({ otp_code: values.otp_code }, this.state.values)
		)
			.then((res) => {
				this.setState({ otpDialogIsOpen: false });
				if (res.data.token)
					this.setState({ token: res.data.token });
				if (res.data && res.data.callbackUrl)
					this.redirectToService(res.data.callbackUrl);
				else
					this.checkLogin();
			})
			.catch(errorHandler);
	};

	onAcceptTerms = () => {
		localStorage.setItem('termsAccepted', true);
		if (this.state.token)
			storeLoginResult(this.state.token);
		this.setState({ termsDialogIsOpen: false, depositDialogIsOpen: true });
	};

	onCloseDialog = () => {
		this.setState({ otpDialogIsOpen: false });
	};

	onCloseLogoutDialog = () => {
		this.props.setLogoutMessage();
		this.setState({ logoutDialogIsOpen: false });
	};

	gotoWallet = () => {
		this.props.router.replace('/wallet');
		this.setState({ depositDialogIsOpen: false });
		localStorage.setItem('deposit_initial_display', true);
	};

	render() {
		const { logoutMessage, activeTheme } = this.props;
		const { otpDialogIsOpen, logoutDialogIsOpen, termsDialogIsOpen, depositDialogIsOpen } = this.state;
		return (
			<div className={classnames(...FLEX_CENTER_CLASSES, 'flex-column', 'f-1')}>
				<div
					className={classnames(
						...FLEX_CENTER_CLASSES,
						'flex-column',
						'auth_wrapper',
						'w-100'
					)}
				>
					<IconTitle
						iconPath={activeTheme === 'dark' ? HOLLAEX_LOGO_BLACK : HOLLAEX_LOGO}
						text={STRINGS.LOGIN_TEXT}
						textType="title"
						underline={true}
						useSvg={true}
						className="w-100 exir-logo"
						imageWrapperClassName="auth_logo-wrapper"
						subtitle={STRINGS.formatString(
							STRINGS.LOGIN.LOGIN_TO,
							STRINGS.APP_TITLE.toUpperCase()
						)}
						actionProps={{
							text: STRINGS.LOGIN.CANT_LOGIN,
							iconPath: ICONS.BLUE_ARROW_RIGHT,
							onClick: this.redirectToResetPassword,
							useSvg: true
						}}
					/>
					<div
						className={classnames(
							...FLEX_CENTER_CLASSES,
							'flex-column',
							'auth_form-wrapper',
							'w-100'
						)}
					>
						<LoginForm onSubmit={this.onSubmitLogin} theme={activeTheme} />
						{isMobile && <BottomLink />}
					</div>
				</div>
				{!isMobile && <BottomLink />}
				<Dialog
					isOpen={otpDialogIsOpen || logoutDialogIsOpen || termsDialogIsOpen || depositDialogIsOpen}
					label="otp-modal"
					onCloseDialog={this.onCloseDialog}
					shouldCloseOnOverlayClick={otpDialogIsOpen ? false : true}
					showCloseText={otpDialogIsOpen ? true : false}
					className="login-dialog"
					useFullScreen={isMobile}
					showBar={otpDialogIsOpen}
					theme={activeTheme}
				>
					{otpDialogIsOpen && <OtpForm onSubmit={this.onSubmitLoginOtp} />}
					{logoutDialogIsOpen && (
						<Notification
							type={NOTIFICATIONS.LOGOUT}
							onClose={this.onCloseLogoutDialog}
							data={{ message: logoutMessage }}
						/>
					)}
					{termsDialogIsOpen && <TermsOfService onAcceptTerms={this.onAcceptTerms} />}
					{depositDialogIsOpen && <DepositFunds gotoWallet={this.gotoWallet} />}
				</Dialog>
			</div>
		);
	}
}

const mapStateToProps = (store) => ({
	activeTheme: store.app.theme,
	logoutMessage: store.auth.logoutMessage
});

const mapDispatchToProps = (dispatch) => ({
	setLogoutMessage: bindActionCreators(setLogoutMessage, dispatch),
	change: bindActionCreators(change, dispatch)
});

export default connect(mapStateToProps, mapDispatchToProps)(Login);
