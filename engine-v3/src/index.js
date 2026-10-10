"use strict";

module.exports = {
  ...require("./contracts"),
  ...require("./component-registry"),
  ...require("./component-result"),
  ...require("./proposal-bus"),
  ...require("./ownership-trace"),
  ...require("./native-control-shadow"),
  ...require("./controller"),
  ...require("./native-hierarchical-root"),
  ...require("./option-policy-certificate"),
  ...require("./v2-bridge-kernel"),
  ...require("./diagnostic-bot"),
  ...require("./legacy/default-source"),
  ...require("./legacy/v1-runtime"),
  ...require("./legacy/native-v1-runtime"),
  ...require("./adapters/v2-contact-attack"),
  ...require("./adapters/v2-bridge-components"),
  ...require("./adapters/v2-hard-final"),
  ...require("./adapters/v2-committed-escape"),
  ...require("./adapters/v2-forced-win"),
  ...require("./adapters/v2-combat-attack"),
  ...require("./adapters/v2-preemptive-safety"),
  ...require("./adapters/v2-stability"),
  ...require("./adapters/v2-tactical-core"),
  ...require("./adapters/v2-native-base-policy-tactical"),
  ...require("./adapters/v2-strategic-navigation")
};
