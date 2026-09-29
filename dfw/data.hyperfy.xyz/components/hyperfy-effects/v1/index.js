'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var React = require('react');
var hyperfy = require('hyperfy');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var React__default = /*#__PURE__*/_interopDefaultLegacy(React);

function Effects() {
  const fields = hyperfy.useFields();
  return /*#__PURE__*/React__default["default"].createElement("app", null, fields.fly && /*#__PURE__*/React__default["default"].createElement("effect", {
    name: "fly"
  }), fields.climb && /*#__PURE__*/React__default["default"].createElement("effect", {
    name: "climb"
  }), fields.glide && /*#__PURE__*/React__default["default"].createElement("effect", {
    name: "glide"
  }));
}
const initialState = {// ...
};
function getStore() {
  let state = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : initialState;
  return {
    state,
    actions: {},
    fields: [{
      key: 'fly',
      label: 'Flying',
      type: 'switch',
      options: [{
        label: 'Yes',
        value: true
      }, {
        label: 'No',
        value: false
      }],
      initial: false
    }, {
      key: 'climb',
      label: 'Climbing',
      type: 'switch',
      options: [{
        label: 'Yes',
        value: true
      }, {
        label: 'No',
        value: false
      }],
      initial: false
    }, {
      key: 'glide',
      label: 'Gliding',
      type: 'switch',
      options: [{
        label: 'Yes',
        value: true
      }, {
        label: 'No',
        value: false
      }],
      initial: false
    }]
  };
}

exports["default"] = Effects;
exports.getStore = getStore;
