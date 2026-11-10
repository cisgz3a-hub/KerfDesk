// The camera picture worker (ADR-490 Amendment 2): reads, flattens and
// encodes camera frames for job watch and remote stills, off the UI thread.

import { doPictureWork, type PictureRequest } from './picture-work';

type Incoming = { readonly id: number; readonly request: PictureRequest };

self.onmessage = (event: MessageEvent<Incoming>) => {
  const { id, request } = event.data;
  void doPictureWork(request).then((reply) => {
    const transfer = reply.kind === 'flat-image' ? [reply.image.data.buffer] : [];
    (self as unknown as Worker).postMessage({ id, reply }, transfer);
  });
};
