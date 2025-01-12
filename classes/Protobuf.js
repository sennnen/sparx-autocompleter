import { decodeVarint } from "../utils/varint.js";
import { decodeStringOrBytes } from "./ProtobufPart.js";

class BufferReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  readVarInt() {
    const result = decodeVarint(this.buffer, this.offset);
    this.offset += result.length;

    return result.value;
  }

  readBuffer(length) {
    this.checkByte(length);
    const result = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;

    return result;
  }

  // gRPC has some additional header - remove it
  trySkipGrpcHeader() {
    const backupOffset = this.offset;

    if (this.buffer[this.offset] === 0 && this.leftBytes() >= 5) {
      this.offset++;
      const length = this.buffer.readInt32BE(this.offset);
      this.offset += 4;

      if (length > this.leftBytes()) {
        // Something is wrong, revert
        this.offset = backupOffset;
      }
    }
  }

  leftBytes() {
    return this.buffer.length - this.offset;
  }

  checkByte(length) {
    const bytesAvailable = this.leftBytes();
    if (length > bytesAvailable) {
      throw new Error(
        "Not enough bytes left. Requested: " +
          length +
          " left: " +
          bytesAvailable
      );
    }
  }

  checkpoint() {
    this.savedOffset = this.offset;
  }

  resetToCheckpoint() {
    this.offset = this.savedOffset;
  }
}

export const TYPES = {
  VARINT: 0,
  FIXED64: 1,
  LENDELIM: 2,
  FIXED32: 5
};

export function decodeProto(buffer) {
  const reader = new BufferReader(buffer);
  const parts = [];

  reader.trySkipGrpcHeader();

  try {
    while (reader.leftBytes() > 0) {
      reader.checkpoint();

      const byteRange = [reader.offset];
      const indexType = parseInt(reader.readVarInt().toString());
      const type = indexType & 0b111;
      const index = indexType >> 3;

      let value;
      if (type === TYPES.VARINT) {
        value = reader.readVarInt().toString();
      } else if (type === TYPES.LENDELIM) {
        const length = parseInt(reader.readVarInt().toString());
        value = reader.readBuffer(length);
      } else if (type === TYPES.FIXED32) {
        value = reader.readBuffer(4);
      } else if (type === TYPES.FIXED64) {
        value = reader.readBuffer(8);
      } else {
        throw new Error("Unknown type: " + type);
      }
      byteRange.push(reader.offset);

      parts.push({
        byteRange,
        index,
        type,
        value
      });
    }
  } catch (err) {
    reader.resetToCheckpoint();
  }

  return {
    parts,
    leftOver: reader.readBuffer(reader.leftBytes())
  };
}
export function decodeProtoRecursive(buffer) {
    const result = decodeProto(buffer);
    const parts = result.parts;
    
    for (const part of parts) {
        if (part.type === TYPES.LENDELIM) {
            const decoded = decodeStringOrBytes(part.value);
            if (decoded.type == 'bytes') {
                part.value = decodeProtoRecursive(part.value);
            } else {
                part.value = decoded.value;
            }
        }
    }
    
    return parts;
}

export function typeToString(type, subType) {
  switch (type) {
    case TYPES.VARINT:
      return "varint";
    case TYPES.LENDELIM:
      return subType || "len_delim";
    case TYPES.FIXED32:
      return "fixed32";
    case TYPES.FIXED64:
      return "fixed64";
    default:
      return "unknown";
  }
}



// Thanks ChatGPT

import { encodeVarint } from "../utils/varint.js";

class BufferWriter {
  constructor() {
    this.buffers = [];
  }

  writeVarInt(value) {
    const encoded = encodeVarint(value);
    this.buffers.push(Buffer.from(encoded));
  }

  writeBuffer(data) {
    this.buffers.push(Buffer.from(data));
  }

  writeFixed32(value) {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value, 0);
    this.buffers.push(buffer);
  }

  writeFixed64(value) {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(BigInt(value), 0);
    this.buffers.push(buffer);
  }

  getBuffer() {
    return Buffer.concat(this.buffers);
  }
}

export function encodeProto(parts) {
  const writer = new BufferWriter();

  for (const part of parts) {
    const { index, type, value } = part;

    if (index === undefined || type === undefined || value === undefined) {
      throw new Error("Invalid part format. Requires index, type, and value.");
    }

    // Construct the field key: (index << 3) | type
    const key = (index << 3) | type;
    writer.writeVarInt(key);

    switch (type) {
      case TYPES.VARINT:
        writer.writeVarInt(value);
        break;

      case TYPES.LENDELIM:
        if (Buffer.isBuffer(value)) {
          writer.writeVarInt(value.length);
          writer.writeBuffer(value);
        } else if (typeof value === "string") {
          const encodedString = Buffer.from(value, "utf-8");
          writer.writeVarInt(encodedString.length);
          writer.writeBuffer(encodedString);
        } else if (Array.isArray(value)) {
          // Nested message
          const nestedBuffer = encodeProto(value);
          writer.writeVarInt(nestedBuffer.length);
          writer.writeBuffer(nestedBuffer);
        } else {
          throw new Error("Unsupported LENDELIM value type.");
        }
        break;

      case TYPES.FIXED32:
        writer.writeFixed32(value);
        break;

      case TYPES.FIXED64:
        writer.writeFixed64(value);
        break;

      default:
        throw new Error("Unknown type: " + type);
    }
  }

  return writer.getBuffer();
}
