import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CHUNK_BYTES, validId } from './party.protocol';
import { PartyService } from './party.service';

function videoVersion(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d+$/.test(value))
    throw new BadRequestException('Invalid video version.');
  return Number(value);
}

const cookieName = (id: string) => `mahoura_room_${id}`;
function credential(req: Request, id: string) {
  if (!validId(id)) return undefined;
  return req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName(id)}=`))
    ?.slice(cookieName(id).length + 1);
}
function session(res: Response, id: string, value: string) {
  res.cookie(cookieName(id), value, {
    httpOnly: true,
    sameSite: 'strict',
    path: `/api/party/rooms/${id}`,
    maxAge: 24 * 60 * 60 * 1000,
  });
}

@Controller('api/party/rooms')
export class PartyController {
  constructor(private readonly party: PartyService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  async create(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const { id, hostToken } = await this.party.create(body?.name);
    session(res, id, hostToken);
    return { id };
  }

  @Post(':id/join')
  @HttpCode(200)
  async join(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const secret = await this.party.join(id, body?.invite, body?.name);
    session(res, id, secret);
    return { ok: true };
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  snapshot(@Param('id') id: string, @Req() req: Request) {
    return this.party.snapshot(id, credential(req, id));
  }

  @Get(':id/events')
  async events(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const secret = credential(req, id);
    const initial = await this.party.snapshot(id, secret);
    if (res.destroyed) return;
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 500\n\n');
    let busy = false;
    let pending = false;
    let closed = false;
    const send = (snapshot: typeof initial) => {
      if (closed) return;
      if (res.writableLength > 512 * 1024) {
        res.end();
        return;
      }
      if (!res.writableNeedDrain) res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    };
    const refresh = async () => {
      if (closed) return;
      if (busy) {
        pending = true;
        return;
      }
      busy = true;
      try {
        send(await this.party.snapshot(id, secret));
      } catch {
        if (!closed) res.end();
      } finally {
        busy = false;
        if (pending && !closed) {
          pending = false;
          void refresh();
        }
      }
    };
    const unsubscribe = this.party.subscribe(id, () => {
      void refresh();
    });
    const stop = this.party.onShutdown(() => {
      res.end();
    });
    // Periodic snapshots also heal missed notifications and clock drift.
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    const lifetime = setTimeout(() => res.end(), 120_000);
    res.once('close', () => {
      closed = true;
      clearInterval(timer);
      clearTimeout(lifetime);
      unsubscribe();
      stop();
    });
    send(initial);
    void refresh();
  }

  @Post(':id/video')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  reserve(@Param('id') id: string, @Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.party.reserve(id, credential(req, id), body ?? {});
  }

  @Put(':id/video')
  async upload(
    @Param('id') id: string,
    @Query('offset') offset: string,
    @Query('v') version: string | undefined,
    @Req() req: Request,
  ) {
    if (req.headers['content-type'] !== 'application/octet-stream' || !/^\d+$/.test(offset ?? ''))
      throw new BadRequestException('Expected a binary chunk and numeric offset.');
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      length += chunk.length;
      if (length > CHUNK_BYTES) throw new BadRequestException('Chunk exceeds 4 MiB.');
      chunks.push(chunk);
    }
    return this.party.upload(
      id,
      credential(req, id),
      Number(offset),
      Buffer.concat(chunks),
      videoVersion(version),
    );
  }

  @Get(':id/video')
  async video(
    @Param('id') id: string,
    @Query('v') version: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const media = await this.party.media(id, credential(req, id), videoVersion(version));
    res.set({
      'Content-Type': media.type,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    // Express streams the file and implements byte ranges / HEAD / 416.
    res.sendFile(
      media.path,
      { cacheControl: false, lastModified: false, acceptRanges: true, dotfiles: 'allow' },
      (error) => {
        if (!error) return;
        if (!res.headersSent) {
          const status = 'status' in error && typeof error.status === 'number' ? error.status : 404;
          res.status(status >= 400 && status <= 599 ? status : 404).end();
        } else if (!res.destroyed) res.destroy();
      },
    );
  }

  @Post(':id/playback')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  control(@Param('id') id: string, @Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.party.control(id, credential(req, id), body ?? {});
  }

  @Post(':id/typing')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  typing(@Param('id') id: string, @Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.party.setTyping(id, credential(req, id), body?.typing);
  }

  @Post(':id/chat')
  @HttpCode(200)
  chat(@Param('id') id: string, @Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.party.event(id, credential(req, id), 'chat', body?.content);
  }

  @Post(':id/reaction')
  @HttpCode(200)
  reaction(@Param('id') id: string, @Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.party.event(id, credential(req, id), 'reaction', body?.content);
  }

  @Delete(':id')
  close(@Param('id') id: string, @Req() req: Request) {
    return this.party.close(id, credential(req, id));
  }
}
