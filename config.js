'use strict';

/**
 * Retrieve the inquirer definition for xcraft-core-etc
 */
module.exports = [
  {
    type: 'list',
    name: 'allowedCommands',
    message: 'List of allowed commands',
    default: [],
  },
];
