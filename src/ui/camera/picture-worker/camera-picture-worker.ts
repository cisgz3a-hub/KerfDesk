// The camera picture worker (ADR-490 Amendment 2): reads, flattens and
// encodes camera frames for job watch and remote stills, off the UI thread,
// and decodes and shrinks the overlay's and the moved check's pictures
// (ADR-440 Amendment 11).

import { doPictureWork, type PictureReply, type PictureRequest } from './picture-work';
import { stillTransfer } from './picture-work-still';

type Incoming = { readonly id: number; readonly request: PictureRequest };

self.onmessage = (event: MessageEvent<Incoming>) => {
  const { id, request } = event.data;
  void doPictureWork(request).then((reply) => {
    (self as unknown as Worker).postMessage({ id, reply }, replyTransfer(reply));
  });
};

// What a reply hands back to the window without a copy.
function replyTransfer(reply: PictureReply): Transferable[] {
  if (reply.kind === 'flat-image') return [reply.image.data.buffer as ArrayBuffer];
  if (reply.kind === 'bitmap') return [reply.bitmap];
  if (reply.kind === 'still') return stillTransfer(reply);
  return [];
}
