'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var React = require('react');
var hyperfy = require('hyperfy');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var React__default = /*#__PURE__*/_interopDefaultLegacy(React);

const DEFAULT_IMAGE = 'thumbnail.png';
function App() {
  const world = hyperfy.useWorld();
  const fields = hyperfy.useFields();
  const image = hyperfy.useFile(fields.image);
  const [visible, setVisible] = React.useState(false);
  React.useLayoutEffect(() => {
    setVisible(fields.mode === 'always');
  }, [fields.mode]);
  let onPointerDown;

  if (fields.mode === 'click') {
    onPointerDown = () => {
      world.unlockPointer();
      setVisible(true);
    };
  }

  return /*#__PURE__*/React__default["default"].createElement("app", null, visible && /*#__PURE__*/React__default["default"].createElement("html", {
    src: fields.url,
    width: fields.width,
    height: fields.height,
    factor: fields.factor,
    onPointerDown: e => {
      if (fields.mode === 'click') {
        e.preventDefault();
        setVisible(false);
      }
    }
  }), !visible && /*#__PURE__*/React__default["default"].createElement("image", {
    src: image || DEFAULT_IMAGE,
    width: fields.width,
    height: fields.height,
    lit: false,
    hitDistance: Infinity,
    onPointerDownHint: onPointerDown ? fields.hint : undefined,
    onPointerDown: onPointerDown
  }), fields.mode === 'proximity' && /*#__PURE__*/React__default["default"].createElement("trigger", {
    size: fields.distance,
    onEnter: () => setVisible(true),
    onLeave: () => setVisible(false)
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
      key: 'url',
      label: 'URL',
      type: 'text',
      instant: false
    }, {
      key: 'width',
      label: 'Width',
      type: 'float',
      initial: 4
    }, {
      key: 'height',
      label: 'Height',
      type: 'float',
      initial: 2.25
    }, {
      key: 'factor',
      label: 'Factor',
      type: 'float',
      initial: 250
    }, {
      key: 'mode',
      label: 'Visibility',
      type: 'dropdown',
      options: [{
        label: 'Always',
        value: 'always'
      }, {
        label: 'On Click',
        value: 'click'
      }, {
        label: 'On Proximity',
        value: 'proximity'
      }],
      initial: 'always'
    }, {
      key: 'hint',
      label: 'Hint',
      type: 'text',
      conditions: [{
        field: 'mode',
        op: 'eq',
        value: 'click'
      }]
    }, {
      key: 'distance',
      label: 'Distance',
      type: 'float',
      initial: 10,
      conditions: [{
        field: 'mode',
        op: 'eq',
        value: 'proximity'
      }]
    }, {
      key: 'image',
      label: 'Image',
      type: 'file',
      accept: '.png,.jpg,.jpeg',
      conditions: [{
        field: 'mode',
        op: 'ne',
        value: 'always'
      }]
    }]
  };
}

exports["default"] = App;
exports.getStore = getStore;
exports.sdkVersion = [2,14,0]
