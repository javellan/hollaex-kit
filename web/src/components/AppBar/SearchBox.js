import React from 'react';
import { reduxForm, reset } from 'redux-form';
import classnames from 'classnames';

import { STATIC_ICONS } from 'config/icons';
import renderFields from 'components/Form/factoryFields';

const FORM_NAME = 'SearchForm';

class SearchBox extends React.Component {
	componentWillUnmount() {
		const { dispatch } = this.props;
		dispatch(reset(FORM_NAME));
	}

	handleOnClear = () => {};

	render() {
		const {
			handleSearch,
			placeHolder,
			className = '',
			outlineClassName = '',
			name,
			showCross = false,
			isFocus,
		} = this.props;
		const searchField = {
			search: {
				name: name,
				type: 'text',
				options: { icon: STATIC_ICONS.SEARCH, label: 'search' },
				className: classnames('search-field', className),
				hideCheck: true,
				outlineClassName: outlineClassName
					? outlineClassName
					: 'app-bar-search-field-outline',
				placeholder: placeHolder,
				onChange: handleSearch,
				showCross: showCross,
				onCrossClick: (e) => {
					handleSearch('');
					this.props.dispatch(reset(FORM_NAME));
				},
				isFocus,
			},
		};

		return renderFields(searchField);
	}
}

export default reduxForm({
	form: FORM_NAME,
})(SearchBox);
