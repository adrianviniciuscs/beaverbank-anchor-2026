const anchor = require("@coral-xyz/anchor");

module.exports = async (provider) => {
    anchor.setProvider(provider);
};
