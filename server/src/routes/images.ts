import { Router, type Response } from 'express';
import { ImageCache, type CachedImage } from '../media/images.js';
import type { Services } from '../services.js';
import { ApiError, badRequest, param, queryString } from './util.js';

function sendImage(res: Response, img: CachedImage, immutable: boolean): void {
  res.setHeader('Content-Type', img.mime);
  res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=86400');
  // Remote artwork is user-contributed (e.g. SVG logos): never let it run as a document.
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(img.path);
}

export function imageRoutes(services: Services): Router {
  const router = Router();

  router.get('/img', async (req, res) => {
    const url = queryString(req, 'u');
    if (!url || !ImageCache.isAllowedRemote(url)) throw badRequest('Unsupported image URL');
    const img = await services.images.remote(url);
    if (!img) throw new ApiError(404, 'Image unavailable');
    sendImage(res, img, true);
  });

  router.get('/img/local/:name', async (req, res) => {
    const img = await services.images.localImage(param(req, 'name'));
    if (!img) throw new ApiError(404, 'Image not found');
    sendImage(res, img, false);
  });

  return router;
}
