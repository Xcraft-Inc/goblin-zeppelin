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
  {
    type: 'input',
    name: 'host',
    message: 'Zeppelin host',
    default: null,
  },
  {
    type: 'input',
    name: 'port',
    message: 'Zeppelin port',
    default: null,
  },
];
