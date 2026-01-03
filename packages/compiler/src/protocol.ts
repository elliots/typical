/**
 * MessagePack-like binary protocol for communicating with the typical compiler.
 * This matches the protocol used by tsgo's --api mode.
 */

const MessagePackTypeFixedArray3 = 0x93
const MessagePackTypeBin8 = 0xc4
const MessagePackTypeBin16 = 0xc5
const MessagePackTypeBin32 = 0xc6
const MessagePackTypeU8 = 0xcc

export const enum MessageType {
  Unknown = 0,
  Request = 1,
  CallResponse = 2,
  CallError = 3,
  Response = 4,
  Error = 5,
  Call = 6,
}

export function encodeRequest(method: string, payload: unknown): Buffer {
  const methodBuf = Buffer.from(method, 'utf8')
  const payloadStr = JSON.stringify(payload)
  const payloadBuf = Buffer.from(payloadStr, 'utf8')

  // Calculate total size
  // 1 byte for array marker (0x93)
  // 2 bytes for message type (0xCC + type)
  // variable for method bin
  // variable for payload bin
  const methodBinSize = getBinEncodingSize(methodBuf.length)
  const payloadBinSize = getBinEncodingSize(payloadBuf.length)
  const totalSize = 1 + 2 + methodBinSize + methodBuf.length + payloadBinSize + payloadBuf.length

  const buf = Buffer.alloc(totalSize)
  let offset = 0

  // Fixed array of 3 elements
  buf[offset++] = MessagePackTypeFixedArray3

  // Message type (u8)
  buf[offset++] = MessagePackTypeU8
  buf[offset++] = MessageType.Request

  // Method (bin)
  offset = writeBin(buf, offset, methodBuf)

  // Payload (bin)
  offset = writeBin(buf, offset, payloadBuf)

  return buf
}

export interface DecodedMessage {
  messageType: MessageType
  method: string
  payload: Buffer
  bytesConsumed: number
}

export function decodeResponse(data: Buffer): DecodedMessage {
  let offset = 0

  // Check array marker
  if (data[offset++] !== MessagePackTypeFixedArray3) {
    throw new Error(`Expected 0x93, got 0x${data[0].toString(16)}`)
  }

  // Read message type
  if (data[offset++] !== MessagePackTypeU8) {
    throw new Error(`Expected 0xCC for message type`)
  }
  const messageType = data[offset++] as MessageType

  // Read method
  const { value: methodBuf, newOffset: offset2 } = readBin(data, offset)
  offset = offset2
  const method = methodBuf.toString('utf8')

  // Read payload
  const { value: payload, newOffset: offset3 } = readBin(data, offset)

  return { messageType, method, payload, bytesConsumed: offset3 }
}

function getBinEncodingSize(length: number): number {
  if (length < 256) return 2 // 1 byte type + 1 byte length
  if (length < 65536) return 3 // 1 byte type + 2 bytes length
  return 5 // 1 byte type + 4 bytes length
}

function writeBin(buf: Buffer, offset: number, data: Buffer): number {
  const length = data.length

  if (length < 256) {
    buf[offset++] = MessagePackTypeBin8
    buf[offset++] = length
  } else if (length < 65536) {
    buf[offset++] = MessagePackTypeBin16
    buf.writeUInt16BE(length, offset)
    offset += 2
  } else {
    buf[offset++] = MessagePackTypeBin32
    buf.writeUInt32BE(length, offset)
    offset += 4
  }

  data.copy(buf, offset)
  return offset + length
}

function readBin(buf: Buffer, offset: number): { value: Buffer; newOffset: number } {
  if (offset >= buf.length) {
    throw new Error('Not enough data: need type byte')
  }
  const type = buf[offset++]
  let length: number

  switch (type) {
    case MessagePackTypeBin8:
      if (offset >= buf.length) throw new Error('Not enough data: need length byte')
      length = buf[offset++]
      break
    case MessagePackTypeBin16:
      if (offset + 2 > buf.length) throw new Error('Not enough data: need 2 length bytes')
      length = buf.readUInt16BE(offset)
      offset += 2
      break
    case MessagePackTypeBin32:
      if (offset + 4 > buf.length) throw new Error('Not enough data: need 4 length bytes')
      length = buf.readUInt32BE(offset)
      offset += 4
      break
    default:
      throw new Error(`Expected bin type (0xC4-0xC6), got 0x${type.toString(16)}`)
  }

  // Check if we have enough data for the full payload
  if (offset + length > buf.length) {
    throw new Error(`Not enough data: need ${length} bytes, have ${buf.length - offset}`)
  }

  const value = buf.subarray(offset, offset + length)
  return { value, newOffset: offset + length }
}
