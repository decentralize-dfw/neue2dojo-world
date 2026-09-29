'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var React = require('react');
var hyperfy = require('hyperfy');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var React__default = /*#__PURE__*/_interopDefaultLegacy(React);

function Place() {
  const editing = hyperfy.useEditing();
  const fields = hyperfy.useFields();
  return /*#__PURE__*/React__default["default"].createElement("app", null, /*#__PURE__*/React__default["default"].createElement("place", {
    label: fields.name,
    rotationY: 0
  }), editing && /*#__PURE__*/React__default["default"].createElement("model", {
    src: "place.glb"
  }));
}
const initialState = {};
function getStore() {
  let state = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : initialState;
  return {
    state,
    actions: {},
    fields: [{
      key: 'name',
      label: 'Name',
      type: 'text',
      descriptor: true
    }]
  };
}

exports["default"] = Place;
exports.getStore = getStore;
