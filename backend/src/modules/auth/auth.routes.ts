import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { prisma } from '../../lib/db';
import { config } from '../../config';

// Глобальный плагин JWT
export const jwtPlugin = jwt({
  name: 'jwt',
  secret: config.apiSecret || 'super_secret_key_123',
});

export const authRoutes = new Elysia({ prefix: '/api/auth' })
  .use(jwtPlugin)
  
  // Регистрация компании (MVP: пока без email верификации)
  .post('/register', async ({ body }) => {
    // В реальном проекте пароль нужно хешировать (например, bcrypt)
    // Для MVP используем простое хеширование или сохраняем как есть (Bun.password.hash можно использовать)
    
    // Проверка, есть ли уже такой email
    const existing = await prisma.company.findUnique({ where: { email: body.email } });
    if (existing) {
      return new Response(JSON.stringify({ success: false, error: 'Email already exists' }), { status: 400 });
    }

    const hashedPassword = await Bun.password.hash(body.password);

    const newCompany = await prisma.company.create({
      data: {
        name: body.name,
        email: body.email,
        password: hashedPassword,
        sipNumber: body.sipNumber,
        systemPrompt: body.systemPrompt,
      }
    });

    return { success: true, message: 'Company registered successfully' };
  }, {
    body: t.Object({
      name: t.String(),
      email: t.String({ format: 'email' }),
      password: t.String({ minLength: 6 }),
      sipNumber: t.String(),
      systemPrompt: t.String(),
    })
  })

  // Вход (Логин)
  .post('/login', async ({ body, jwt }) => {
    const company = await prisma.company.findUnique({
      where: { email: body.email }
    });

    if (!company || !company.password) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid credentials' }), { status: 401 });
    }

    const isMatch = await Bun.password.verify(body.password, company.password);
    if (!isMatch) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid credentials' }), { status: 401 });
    }

    // Генерируем токен, зашифровав id компании
    const token = await jwt.sign({ companyId: company.id });

    return { 
      success: true, 
      token, 
      company: {
        id: company.id,
        name: company.name,
        email: company.email,
        sipNumber: company.sipNumber
      }
    };
  }, {
    body: t.Object({
      email: t.String(),
      password: t.String(),
    })
  });
