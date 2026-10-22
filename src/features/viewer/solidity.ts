import type { HLJSApi, Language } from "highlight.js";

const BITS = 8;
const SIZES = 32;
/** int8 … int256, uint8 … uint256, bytes1 … bytes32. */
const SIZED_TYPES = Array.from({ length: SIZES }, (_, index) => `int${(index + 1) * BITS} uint${(index + 1) * BITS} bytes${index + 1}`).join(" ");

/** Solidity for highlight.js (not among its bundled languages). */
export function solidity(hljs: HLJSApi): Language {
  return {
    name: "Solidity",
    aliases: ["sol"],
    keywords: {
      keyword:
        "pragma import as from contract interface library abstract is using for struct enum event error modifier function constructor " +
        "fallback receive returns return if else while do break continue try catch emit revert require assert new delete public private " +
        "internal external pure view payable constant immutable override virtual memory storage calldata indexed anonymous unchecked " +
        "assembly mapping type let",
      type: `address bool string bytes byte int uint fixed ufixed ${SIZED_TYPES}`,
      literal: "true false wei gwei ether seconds minutes hours days weeks",
      built_in: "msg block tx abi this super selfdestruct keccak256 sha256 ripemd160 ecrecover addmod mulmod gasleft blockhash",
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      hljs.APOS_STRING_MODE,
      hljs.QUOTE_STRING_MODE,
      { className: "number", begin: /\b0x[0-9a-fA-F_]+\b/ },
      hljs.C_NUMBER_MODE,
      { className: "title.function", begin: /(?<=\bfunction\s+)[A-Za-z_$][\w$]*/ },
      { className: "title.class", begin: /(?<=\b(?:contract|interface|library|struct|enum|event|error)\s+)[A-Za-z_$][\w$]*/ },
    ],
  };
}
