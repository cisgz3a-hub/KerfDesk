/** RFC 854 framing only. No option enabling, terminal emulation, or machine command interpretation. */
export class MachineTelnetCodec {
  private state: 'data' | 'iac' | 'option' | 'sub' | 'sub-iac' = 'data';
  private optionCommand = 0;
  private subBytes = 0;
  decode(chunk: Uint8Array): { readonly data: Buffer; readonly reply: Buffer } {
    const data: number[] = [];
    const reply: number[] = [];
    for (const byte of chunk) this.consume(byte, data, reply);
    return { data: Buffer.from(data), reply: Buffer.from(reply) };
  }
  private consume(byte: number, data: number[], reply: number[]): void {
    switch (this.state) {
      case 'data':
        if (byte === 255) this.state = 'iac';
        else data.push(byte);
        return;
      case 'iac':
        this.command(byte, data);
        return;
      case 'option':
        if (this.optionCommand === 253) reply.push(255, 252, byte); // DO -> WONT
        if (this.optionCommand === 251) reply.push(255, 254, byte); // WILL -> DONT
        this.state = 'data';
        return;
      case 'sub':
        this.subBytes += 1;
        if (this.subBytes > 4096) throw new Error('Telnet negotiation exceeds the local limit.');
        if (byte === 255) this.state = 'sub-iac';
        return;
      case 'sub-iac':
        this.state = byte === 240 ? 'data' : 'sub';
        return;
    }
  }
  private command(byte: number, data: number[]): void {
    if (byte === 255) {
      data.push(255);
      this.state = 'data';
    } else if ([251, 252, 253, 254].includes(byte)) {
      this.optionCommand = byte;
      this.state = 'option';
    } else if (byte === 250) {
      this.subBytes = 0;
      this.state = 'sub';
    } else this.state = 'data'; // NOP/GA/etc. are transport framing, never G-code.
  }
}

export function encodeMachineTelnet(data: Uint8Array): Buffer {
  const encoded: number[] = [];
  for (const byte of data) {
    encoded.push(byte);
    if (byte === 255) encoded.push(255);
  }
  return Buffer.from(encoded);
}
