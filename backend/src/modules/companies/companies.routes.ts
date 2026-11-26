import { Elysia, t } from 'elysia';
import { prisma } from '../../lib/db';
import { jwtPlugin } from '../auth/auth.routes';

export const companiesRoutes = new Elysia({ prefix: '/api/companies' })
  .use(jwtPlugin)
  // Защита всех эндпоинтов ниже: проверка JWT токена
  .derive(async ({ jwt, headers }) => {
    const auth = headers['authorization'];
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) throw new Error('Unauthorized');
    
    const payload = await jwt.verify(token);
    if (!payload || !payload.companyId) throw new Error('Invalid token');
    
    return { companyId: payload.companyId as string };
  })
  
  // Получить настройки своей компании
  .get('/me', async ({ companyId }) => {
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new Error('Company not found');
    return { success: true, company };
  })
  
  // Обновить настройки своей компании
  .put('/me', async ({ companyId, body }) => {
    const company = await prisma.company.update({
      where: { id: companyId },
      data: body,
    });
    return { success: true, company };
  }, {
    body: t.Object({
      name: t.Optional(t.String()),
      sipNumber: t.Optional(t.String()),
      systemPrompt: t.Optional(t.String()),
      isActive: t.Optional(t.Boolean()),
      crmConfig: t.Optional(t.Any()),
    })
  })

  // Получить историю звонков своей компании (Call Logs)
  .get('/me/logs', async ({ companyId, query }) => {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.callLog.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.callLog.count({ where: { companyId } })
    ]);

    return {
      success: true,
      logs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }, {
    query: t.Object({
      page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    })
  })
  
  // Получить записи/брони
  .get('/me/bookings', async ({ companyId }) => {
    const bookings = await prisma.booking.findMany({
      where: { companyId },
      orderBy: { date: 'asc' }
    });
    return { success: true, bookings };
  });
