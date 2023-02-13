import React from 'react';
import { ReactSVG } from 'react-svg';
import { STATIC_ICONS } from 'config/icons';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';

const PluginSubscription = ({
	pluginData,
	selectedCrypto,
	isMonthly,
	exchangeCardKey,
	paymentAddressDetails,
	exchangePlanType,
	planPriceData,
}) => {
	const { logo, price, name, payment_type, author } = pluginData;

	return (
		<div className="horizantal-line">
			<div className="plan-header">Selected item</div>
			<div className="subscription-container">
				<div className="plugin-plan-card">
					<div className="card-icon">
						<img src={logo} alt={'logo'} className="plugin-icon" />
					</div>

					<div>
						<div>PLUGIN APP</div>
						<div className="bold">{`${price}-${name}-${payment_type}`}</div>
						<div>{`${price} ${name} ${payment_type} for processing iDenfy.`}</div>
						<div>Save 6%.</div>
						<div className="d-flex mt-2 gray-text">
							<InfoCircleOutlined />
							<div>Requires plugin activation ({name})</div>
						</div>
						<div className="d-flex mt-2 gray-text footer-text">
							<span className="d-flex">
								<Tooltip
									placement="rightBottom"
									title={`Verified plugin by ${author}`}
								>
									<ReactSVG
										src={STATIC_ICONS['VERIFIED_BADGE_PLUGIN_APPS']}
										className="verified-icon"
									/>
								</Tooltip>
								<span>by {author}</span>
							</span>
							<span className="d-flex">
								<ReactSVG
									src={
										STATIC_ICONS[
											payment_type === 'one-time'
												? 'ONE_TIME_ACTIVATION_PLUGIN'
												: payment_type !== 'free'
												? 'CREDITS_PLUGIN'
												: ''
										]
									}
									className="credits-icon"
								/>
								<span>{payment_type}</span>
							</span>
						</div>
					</div>
				</div>
				<div className="payment-container d-flex align-items-center">
					<p className="f-20">
						Cost :
						{paymentAddressDetails?.amount
							? `${paymentAddressDetails.currency.toUpperCase()} ${
									paymentAddressDetails?.amount
							  }`
							: `${price}* USDT`}
					</p>
				</div>
			</div>
			<div className="plugin-plan-footer gray-text">
				*All plugin app purchases are conducted in cryptocurrency only.
			</div>
		</div>
	);
};

export default PluginSubscription;
