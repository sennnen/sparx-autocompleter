import JSBI from "jsbi";

export function decodeVarint(buffer, offset) {
  let res = JSBI.BigInt(0);
  let shift = 0;
  let byte = 0;

  do {
    if (offset >= buffer.length) {
      throw new RangeError("Index out of bound decoding varint");
    }

    byte = buffer[offset++];

    const multiplier = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(shift));
    const thisByteValue = JSBI.multiply(JSBI.BigInt(byte & 0x7f), multiplier);
    shift += 7;
    res = JSBI.add(res, thisByteValue);
  } while (byte >= 0x80);

  return {
    value: res,
    length: shift / 7
  };
}

// Thanks ChatGPT
export function encodeVarint(value) {
  const result = [];
  let bigValue = JSBI.BigInt(value);

  while (JSBI.greaterThan(bigValue, JSBI.BigInt(0x7F))) {
    const byte = JSBI.toNumber(JSBI.bitwiseAnd(bigValue, JSBI.BigInt(0x7F))) | 0x80;
    result.push(byte);

    bigValue = JSBI.signedRightShift(bigValue, JSBI.BigInt(7));
  }

  result.push(JSBI.toNumber(bigValue));

  return result;
}