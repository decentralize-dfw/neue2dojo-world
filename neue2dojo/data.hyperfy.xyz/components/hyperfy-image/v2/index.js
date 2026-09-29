'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var React = require('react');
var hyperfy = require('hyperfy');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var React__default = /*#__PURE__*/_interopDefaultLegacy(React);

const DEFAULT_IMAGE = 'blank-image.png';
function Image() {
  var _fields$$onClick, _fields$file;

  const world = hyperfy.useWorld();
  const fields = hyperfy.useFields();
  const url = hyperfy.useFile(fields.src);
  const onClick = (_fields$$onClick = fields.$onClick) !== null && _fields$$onClick !== void 0 && _fields$$onClick.length ? () => world.trigger('Click') : undefined;
  return /*#__PURE__*/React__default["default"].createElement("app", null, /*#__PURE__*/React__default["default"].createElement("image", {
    src: url || DEFAULT_IMAGE,
    width: fields.width,
    height: fields.height,
    lit: fields.lit,
    doubleside: fields.doubleside,
    treatAsGif: (_fields$file = fields.file) === null || _fields$file === void 0 ? void 0 : _fields$file.isGif,
    frameWidth: fields.frameWidth,
    frameDepth: fields.frameDepth,
    frameColor: fields.frameColor,
    scale: fields.__lockedScale,
    onClick: onClick
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
      key: 'nft',
      type: 'boolean',
      hidden: true,
      initial: false
    }, {
      key: 'src',
      label: 'File',
      type: 'file',
      accept: '.png,.jpg,.jpeg,.gif',
      conditions: [{
        field: 'nft',
        op: 'ne',
        value: true
      }],
      descriptor: true
    }, {
      key: 'width',
      label: 'Width',
      type: 'float'
    }, {
      key: 'height',
      label: 'Height',
      type: 'float',
      initial: 1
    }, {
      key: 'lit',
      label: 'Lit',
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
      key: 'doubleside',
      label: 'Doubleside',
      type: 'switch',
      options: [{
        label: 'Yes',
        value: true
      }, {
        label: 'No',
        value: false
      }],
      initial: true
    }, {
      label: 'Frame',
      type: 'section'
    }, {
      key: 'frameWidth',
      label: 'Width',
      type: 'float',
      initial: null
    }, {
      key: 'frameDepth',
      label: 'Depth',
      type: 'float',
      initial: null
    }, {
      key: 'frameColor',
      label: 'Color',
      type: 'text',
      initial: null
    }, {
      type: 'section',
      label: 'Triggers'
    }, {
      type: 'trigger',
      name: 'Click'
    }, // legacy non-uniform scale
    {
      key: '__lockedScale',
      type: 'vec3',
      hidden: true
    }]
  };
}

exports["default"] = Image;
exports.getStore = getStore;
