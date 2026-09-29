'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var React = require('react');
var hyperfy = require('hyperfy');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var React__default = /*#__PURE__*/_interopDefaultLegacy(React);

const DEFAULT_MODEL = 'block-model.glb';
function Model() {
  var _fields$__lockedScale, _fields$$onClick;

  const world = hyperfy.useWorld();
  const fields = hyperfy.useFields();
  const url = hyperfy.useFile(fields.src);
  const scale = ((_fields$__lockedScale = fields.__lockedScale) === null || _fields$__lockedScale === void 0 ? void 0 : _fields$__lockedScale.map(n => n * fields.scale)) || fields.scale;
  const onClick = (_fields$$onClick = fields.$onClick) !== null && _fields$$onClick !== void 0 && _fields$$onClick.length ? () => world.trigger('Click') : undefined;
  return /*#__PURE__*/React__default["default"].createElement("app", null, /*#__PURE__*/React__default["default"].createElement("rigidbody", {
    type: "kinematic"
  }, /*#__PURE__*/React__default["default"].createElement("model", {
    scale: scale,
    src: url || DEFAULT_MODEL,
    animate: fields.animate,
    collision: fields.collision ? 'trimesh' : undefined,
    onClick: onClick
  })));
}
const initialState = {// ...
};
function getStore() {
  let state = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : initialState;
  return {
    state,
    actions: {},
    fields: [{
      key: 'nft',
      type: 'boolean',
      hidden: true,
      initial: false
    }, {
      key: 'src',
      label: 'Source',
      type: 'file',
      accept: '.glb',
      conditions: [{
        field: 'nft',
        op: 'ne',
        value: true
      }],
      descriptor: true
    }, {
      key: 'scale',
      label: 'Scale',
      type: 'float',
      initial: 1
    }, {
      key: 'animate',
      label: 'Animate',
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
      key: 'collision',
      label: 'Collision',
      type: 'switch',
      options: [{
        label: 'Yes',
        value: true
      }, {
        label: 'No',
        value: false
      }],
      initial: false
    }, // legacy non-uniform scale
    {
      key: '__lockedScale',
      type: 'vec3',
      hidden: true
    }, {
      type: 'section',
      label: 'Events'
    }, {
      type: 'trigger',
      name: 'Click'
    }]
  };
}

exports["default"] = Model;
exports.getStore = getStore;
