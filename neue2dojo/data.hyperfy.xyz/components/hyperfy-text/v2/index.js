'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var React = require('react');
var hyperfy = require('hyperfy');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var React__default = /*#__PURE__*/_interopDefaultLegacy(React);

function Text() {
  var _fields$$onClick;

  const world = hyperfy.useWorld();
  const fields = hyperfy.useFields();
  const onClick = (_fields$$onClick = fields.$onClick) !== null && _fields$$onClick !== void 0 && _fields$$onClick.length ? () => world.trigger('Click') : undefined;
  return /*#__PURE__*/React__default["default"].createElement("app", null, /*#__PURE__*/React__default["default"].createElement("text", {
    value: fields.value,
    fontSize: fields.fontSize,
    color: fields.color,
    align: fields.align,
    lineHeight: fields.lineHeight,
    anchorX: fields.anchorX,
    anchorY: fields.anchorY,
    maxWidth: fields.maxWidth || undefined,
    bgColor: fields.bgColor || undefined,
    bgRadius: fields.bgRadius,
    padding: fields.padding,
    scale: fields.__lockedScale,
    onClick: onClick
  }));
}
const initialState = {// color: 'white',
};
function getStore() {
  let state = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : initialState;
  return {
    state,
    actions: {// setColor(state, color) {
      //   state.color = color
      // },
    },
    fields: [{
      key: 'value',
      label: 'Text',
      type: 'textarea',
      initial: 'Enter text...',
      descriptor: true
    }, {
      key: 'fontSize',
      label: 'Size',
      type: 'float',
      initial: 0.2
    }, {
      key: 'color',
      label: 'Color',
      type: 'text',
      initial: '#000'
    }, {
      key: 'align',
      label: 'Align',
      type: 'switch',
      options: [{
        label: 'Left',
        value: 'left'
      }, {
        label: 'Center',
        value: 'center'
      }, {
        label: 'Right',
        value: 'right'
      }],
      initial: 'left'
    }, {
      key: 'lineHeight',
      label: 'Line Height',
      type: 'float',
      initial: 1.4
    }, {
      label: 'Layout',
      type: 'section'
    }, {
      key: 'anchorX',
      label: 'AnchorX',
      type: 'dropdown',
      options: [{
        label: 'Left',
        value: 'left'
      }, {
        label: 'Center',
        value: 'center'
      }, {
        label: 'Right',
        value: 'right'
      }],
      initial: 'center'
    }, {
      key: 'anchorY',
      label: 'AnchorY',
      type: 'dropdown',
      options: [{
        label: 'Top',
        value: 'top'
      }, {
        label: 'Top Baseline',
        value: 'top-baseline'
      }, {
        label: 'Middle',
        value: 'middle'
      }, {
        label: 'Bottom Baseline',
        value: 'bottom-baseline'
      }, {
        label: 'Bottom',
        value: 'bottom'
      }],
      initial: 'middle'
    }, {
      key: 'maxWidth',
      label: 'Max Width',
      type: 'float',
      initial: null
    }, {
      label: 'Background',
      type: 'section'
    }, {
      key: 'bgColor',
      label: 'Color',
      type: 'text',
      initial: null
    }, {
      key: 'bgRadius',
      label: 'Radius',
      type: 'float',
      initial: 0
    }, {
      key: 'padding',
      label: 'Padding',
      type: 'float',
      initial: 0
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

exports["default"] = Text;
exports.getStore = getStore;
