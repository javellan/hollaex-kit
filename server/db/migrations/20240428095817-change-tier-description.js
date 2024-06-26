'use strict';

const TABLE = 'Tiers';
const COLUMN = 'description';

module.exports = {
	up: (queryInterface, Sequelize) =>
		queryInterface.changeColumn(TABLE, COLUMN, {
			type: Sequelize.TEXT,
			allowNull: true,
		}),
	down: (queryInterface, Sequelize) =>
		queryInterface.changeColumn(TABLE, COLUMN, {
			type: Sequelize.STRING,
			allowNull: true,
		})
};