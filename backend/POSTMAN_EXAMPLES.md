# 📮 Postman запросы для AI Assistant

## 🏠 Базовый URL
```
http://localhost:3000
```

---

## 1️⃣ Проверка работы сервера
**GET** `/`

**Headers:**
```
Content-Type: application/json
```

**Response:**
```json
{
  "message": "AI Assistant API",
  "version": "1.0.0",
  "endpoints": {
    "POST /api/process-request": "Обработать запрос пользователя",
    "GET /api/tasks/:userId": "Получить задачи пользователя",
    "PUT /api/tasks/:taskId/approve": "Утвердить задачу",
    "PUT /api/tasks/:taskId/reject": "Отклонить задачу"
  }
}
```

---

## 2️⃣ Создание задачи (основной запрос)
**POST** `/api/process-request`

**Headers:**
```
Content-Type: application/json
```

**Body (raw JSON):**
```json
{
  "name": "Rauan",
  "number": "+777130129391",
  "text": "зарезирвируй мне столик в ресторане DelPapa который находится на республике в 20:00 сегодня",
  "city": "Астана"
}
```

**Response (успех):**
```json
{
  "success": true,
  "taskId": "clx123...",
  "task": {
    "name": "DelPapa",
    "number": "+7 727 123 45 67",
    "street": "ул. Республика, 20/3",
    "time": "20:00",
    "additionalInfo": "Бронирование на сегодня, 2 человека"
  },
  "message": "Задача создана. Ожидайте подтверждения."
}
```

**Response (ошибка):**
```json
{
  "success": false,
  "error": "Произошла ошибка при обработке запроса"
}
```

---

## 3️⃣ Примеры других запросов

### Запись в барбершоп
**POST** `/api/process-request`

**Body:**
```json
{
  "name": "Данияр",
  "number": "+77051234567",
  "text": "запиши меня в барбершоп Стиль на завтра в 15:00 на стрижку",
  "city": "Алматы"
}
```

### Запись к врачу
**POST** `/api/process-request`

**Body:**
```json
{
  "name": "Айгуль",
  "number": "+77059876543",
  "text": "запиши к терапевту в клинику Медицинский центр на послезавтра в 10:00",
  "city": "Шымкент"
}
```

### Заказ пиццы
**POST** `/api/process-request`

**Body:**
```json
{
  "name": "Ермек",
  "number": "+77051112233",
  "text": "закажи пиццу пепперони из Domino's на Абая 120 доставить через 30 минут",
  "city": "Астана"
}
```

---

## 4️⃣ Получение задач пользователя
**GET** `/api/tasks/{userId}`

**Headers:**
```
Content-Type: application/json
```

**URL Parameters:**
- `userId` - ID пользователя (возвращается в ответе при создании задачи)

**Response:**
```json
{
  "success": true,
  "tasks": [
    {
      "id": "clx123...",
      "userId": "clx456...",
      "originalText": "зарезирвируй мне столик...",
      "status": "PENDING",
      "taskName": "Бронирование столика",
      "placeName": "DelPapa",
      "placeNumber": "+7 727 123 45 67",
      "address": "ул. Республика, 20/3",
      "time": "20:00",
      "additionalInfo": "Бронирование на сегодня",
      "createdAt": "2024-03-20T12:00:00.000Z",
      "updatedAt": "2024-03-20T12:00:00.000Z",
      "user": {
        "id": "clx456...",
        "name": "Rauan",
        "number": "+777130129391",
        "city": "Астана",
        "createdAt": "2024-03-20T12:00:00.000Z",
        "updatedAt": "2024-03-20T12:00:00.000Z"
      }
    }
  ]
}
```

---

## 5️⃣ Утверждение задачи
**PUT** `/api/tasks/{taskId}/approve`

**Headers:**
```
Content-Type: application/json
```

**URL Parameters:**
- `taskId` - ID задачи для утверждения

**Response:**
```json
{
  "success": true,
  "task": {
    "id": "clx123...",
    "status": "APPROVED",
    // ... остальная информация о задаче
  },
  "message": "Задача утверждена"
}
```

---

## 6️⃣ Отклонение задачи
**PUT** `/api/tasks/{taskId}/reject`

**Headers:**
```
Content-Type: application/json
```

**URL Parameters:**
- `taskId` - ID задачи для отклонения

**Response:**
```json
{
  "success": true,
  "task": {
    "id": "clx123...",
    "status": "REJECTED",
    // ... остальная информация о задаче
  },
  "message": "Задача отклонена"
}
```

---

## 🔧 Настройка Postman

### 1. Создание коллекции
1. Откройте Postman
2. Создайте новую коллекцию "AI Assistant"
3. Добавьте все запросы выше

### 2. Переменные окружения (опционально)
Создайте environment с переменными:
```
baseUrl: http://localhost:3000
```

Тогда в запросах используйте `{{baseUrl}}` вместо полного URL.

### 3. Тестирование последовательности:
1. Сначала отправьте `GET /` для проверки
2. Создайте задачу через `POST /api/process-request`
3. Скопируйте `taskId` из ответа
4. Получите задачи через `GET /api/tasks/{userId}`
5. Утвердите или отклоните задачу через `PUT`

---

## 🚨 Возможные ошибки

### Если сервер не отвечает:
1. Убедитесь что сервер запущен: `bun run dev`
2. Проверьте что Docker контейнер работает: `bun run docker:up`

### Если ошибка базы данных:
1. Проверьте права доступа к PostgreSQL
2. Убедитесь что таблицы созданы

### Если ошибка Gemini API:
1. Проверьте API ключ в `.env` файле
2. Убедитесь что есть доступ к интернету
