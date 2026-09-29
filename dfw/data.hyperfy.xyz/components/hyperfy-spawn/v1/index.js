'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var React = require('react');
var hyperfy = require('hyperfy');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var React__default = /*#__PURE__*/_interopDefaultLegacy(React);

function Spawn() {
  const editing = hyperfy.useEditing();
  return /*#__PURE__*/React__default["default"].createElement("app", null, /*#__PURE__*/React__default["default"].createElement("spawn", {
    priority: 2
  }), editing && /*#__PURE__*/React__default["default"].createElement("model", {
    src: "spawn-block.glb"
  }));
}

exports["default"] = Spawn;
