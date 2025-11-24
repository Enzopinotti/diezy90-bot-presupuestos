// src/routes/wati.webhook.routes.js
import express from 'express';
import multer from 'multer';
import { verifyWatiSignature } from '../middlewares/verifyWatiSignature.js';
import { watiInboundController } from '../controllers/wati/inbound.controller.js';

const upload = multer({ dest: 'tmp/' });
export const watiRouter = express.Router();

// Texto + media entrante
watiRouter.post('/wati', verifyWatiSignature, upload.any(), watiInboundController);
