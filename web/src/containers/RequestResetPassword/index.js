import React, { Component } from 'react';
import classnames from 'classnames';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { isMobile } from 'react-device-detect';
import { Link } from 'react-router';

import { SubmissionError, change } from 'redux-form';
import { requestResetPassword } from 'actions/authAction';
import ResetPasswordForm, { generateFormFields } from './ResetPasswordForm';
import { IconTitle, Dialog, MobileBarBack } from 'components';
import { ContactForm } from 'containers';
import { FLEX_CENTER_CLASSES } from 'config/constants';
import STRINGS from 'config/localizedStrings';
import RequestResetPasswordSuccess from './RequestResetPasswordSuccess';
import withConfig from 'components/ConfigProvider/withConfig';
import { openContactForm } from 'actions/appActions';

let errorTimeOut = null;

const BottomLink = () => (
	<>
		<div className={classnames('f-1', 'link_wrapper')}>
			{STRINGS['SIGN_UP.HAVE_ACCOUNT']}
			<Link to="/login" className={classnames('blue-link')}>
				{STRINGS['SIGN_UP.GOTO_LOGIN']}
			</Link>
		</div>
		<div className={classnames('f-1', 'link_wrapper')}>
			{STRINGS['LOGIN.NO_ACCOUNT']}
			<Link to="/signup" className={classnames('blue-link')}>
				{STRINGS['LOGIN.CREATE_ACCOUNT']}
			</Link>
		</div>
	</>
);

class RequestResetPassword extends Component {
	constructor(props) {
		super(props);
		this.state = {
			success: false,
			showContactForm: false,
			formFields: generateFormFields(this.props.activeTheme),
		};
	}

	componentWillUnmount() {
		if (errorTimeOut) {
			clearTimeout(errorTimeOut);
		}
	}

	onSubmitRequestResetPassword = (values) => {
		return requestResetPassword(values)
			.then((res) => {
				this.setState({ success: true });
			})
			.catch((error) => {
				if (error.response && error.response.status === 404) {
					this.setState({ success: true });
				} else {
					const errors = {};
					if (error.response) {
						const { message = '' } = error.response.data;
						errors._error = message || error.message;
					} else {
						errors._error = error.message;
					}
					throw new SubmissionError(errors);
				}
			});
	};

	onCloseDialog = () => {
		this.setState({ showContactForm: false });
	};

	onClickLogin = () => {
		this.props.router.replace('login');
	};

	onGoBack = () => {
		this.props.router.push(`/login`);
	};

	accountRecovery = () => {
		this.setState({ success: false });
	};

	render() {
		const { languageClasses, icons: ICONS, openContactForm } = this.props;
		const { success, showContactForm, formFields } = this.state;

		return (
			<div className={classnames(...FLEX_CENTER_CLASSES, 'flex-column', 'f-1')}>
				{isMobile && !showContactForm && (
					<MobileBarBack
						onBackClick={success ? this.accountRecovery : this.onGoBack}
					></MobileBarBack>
				)}
				{success ? (
					<RequestResetPasswordSuccess
						onLoginClick={this.onClickLogin}
						onContactUs={openContactForm}
					/>
				) : (
					<div
						className={classnames(
							...FLEX_CENTER_CLASSES,
							'flex-column',
							'auth_wrapper',
							'w-100'
						)}
					>
						<IconTitle
							iconId="ACCOUNT_RECOVERY"
							iconPath={ICONS['ACCOUNT_RECOVERY']}
							stringId="REQUEST_RESET_PASSWORD.TITLE"
							text={STRINGS['REQUEST_RESET_PASSWORD.TITLE']}
							textType="title"
							underline={true}
							className="w-100"
							subtitle={STRINGS['REQUEST_RESET_PASSWORD.SUBTITLE']}
							actionProps={{
								text: STRINGS['REQUEST_RESET_PASSWORD.SUPPORT'],
								iconPath: ICONS['BLUE_QUESTION'],
								onClick: openContactForm,
								useSvg: true,
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
							<ResetPasswordForm
								onSubmit={this.onSubmitRequestResetPassword}
								formFields={formFields}
							/>
							{isMobile && <BottomLink />}
						</div>
					</div>
				)}
				<Dialog
					isOpen={showContactForm}
					label="contact-modal"
					onCloseDialog={this.onCloseDialog}
					shouldCloseOnOverlayClick={false}
					style={{ 'z-index': 100 }}
					className={classnames(languageClasses)}
					showCloseText={false}
				>
					<ContactForm
						onSubmitSuccess={this.onCloseDialog}
						onClose={this.onCloseDialog}
					/>
				</Dialog>
				{!isMobile && <BottomLink />}
			</div>
		);
	}
}

const mapStateToProps = (store) => ({
	activeTheme: store.app.theme,
	constants: store.app.constants,
});

const mapDispatchToProps = (dispatch) => ({
	change: bindActionCreators(change, dispatch),
	openContactForm: bindActionCreators(openContactForm, dispatch),
});

export default connect(
	mapStateToProps,
	mapDispatchToProps
)(withConfig(RequestResetPassword));
