"use strict";

const util = require("util");

if (typeof util.isDate !== "function") {
  util.isDate = function isDate(value) {
    return value instanceof Date;
  };
}
