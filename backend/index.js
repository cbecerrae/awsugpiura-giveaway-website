const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  QueryCommand,
  DeleteCommand,
  BatchWriteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { v4: uuidv4 } = require("uuid");

const SORTEOS_TABLE = process.env.SORTEOS_TABLE;
const PARTICIPANTES_TABLE = process.env.PARTICIPANTES_TABLE;
const ADMIN_KEY = process.env.ADMIN_KEY;

if (!ADMIN_KEY) {
  throw new Error("Missing required environment variable: ADMIN_KEY");
}

if (!SORTEOS_TABLE || !PARTICIPANTES_TABLE) {
  throw new Error("Missing required environment variables: SORTEOS_TABLE, PARTICIPANTES_TABLE");
}

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Admin-Key",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Content-Type": "application/json",
};

const response = (statusCode, body) => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify(body),
});

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value || "{}");
  } catch (_error) {
    return null;
  }
};

const validateAdmin = (event) => {
  const key = (event.headers && (event.headers["X-Admin-Key"] || event.headers["x-admin-key"])) || "";
  return key === ADMIN_KEY;
};

const chunkArray = (arr, chunkSize) => {
  const chunks = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize));
  }
  return chunks;
};

// ─── SORTEOS CRUD ───────────────────────────────────────────────────────────────

const createSorteo = async (event) => {
  if (!validateAdmin(event)) {
    return response(401, { message: "Clave de administrador incorrecta." });
  }

  const payload = safeJsonParse(event.body);
  if (!payload) {
    return response(400, { message: "Body JSON invalido." });
  }

  const name = String(payload.name || "").trim();
  const group = String(payload.group || "").trim();
  const raffleDate = String(payload.raffleDate || "").trim();

  if (!name || !group || !raffleDate) {
    return response(400, { message: "Campos requeridos: name, group, raffleDate." });
  }

  const sorteo = {
    sorteoId: uuidv4(),
    name,
    group,
    raffleDate,
    status: "open",
    participantCount: 0,
    createdAt: new Date().toISOString(),
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: SORTEOS_TABLE,
        Item: sorteo,
      })
    );

    return response(201, { message: "Sorteo creado.", sorteo });
  } catch (error) {
    console.error("createSorteo error", error);
    return response(500, { message: "Error interno al crear sorteo." });
  }
};

const listSorteos = async () => {
  try {
    let items = [];
    let lastKey;

    do {
      const result = await docClient.send(
        new ScanCommand({
          TableName: SORTEOS_TABLE,
          ExclusiveStartKey: lastKey,
        })
      );
      items = items.concat(result.Items || []);
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    // Sort by createdAt descending
    items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

    return response(200, { sorteos: items });
  } catch (error) {
    console.error("listSorteos error", error);
    return response(500, { message: "Error interno al listar sorteos." });
  }
};

const getSorteo = async (sorteoId) => {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: SORTEOS_TABLE,
        Key: { sorteoId },
      })
    );

    if (!result.Item) {
      return response(404, { message: "Sorteo no encontrado." });
    }

    return response(200, { sorteo: result.Item });
  } catch (error) {
    console.error("getSorteo error", error);
    return response(500, { message: "Error interno." });
  }
};

const updateSorteoStatus = async (event, sorteoId, newStatus) => {
  if (!validateAdmin(event)) {
    return response(401, { message: "Clave de administrador incorrecta." });
  }

  try {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: SORTEOS_TABLE,
        Key: { sorteoId },
        UpdateExpression: "SET #status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":status": newStatus },
        ConditionExpression: "attribute_exists(sorteoId)",
        ReturnValues: "ALL_NEW",
      })
    );

    return response(200, { message: `Sorteo ${newStatus}.`, sorteo: result.Attributes });
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      return response(404, { message: "Sorteo no encontrado." });
    }
    console.error("updateSorteoStatus error", error);
    return response(500, { message: "Error interno." });
  }
};

const deleteSorteo = async (event, sorteoId) => {
  if (!validateAdmin(event)) {
    return response(401, { message: "Clave de administrador incorrecta." });
  }

  try {
    // First delete all participants of this sorteo
    await clearParticipantsOfSorteo(sorteoId);

    // Then delete the sorteo itself
    await docClient.send(
      new DeleteCommand({
        TableName: SORTEOS_TABLE,
        Key: { sorteoId },
      })
    );

    return response(200, { message: "Sorteo y sus participantes eliminados." });
  } catch (error) {
    console.error("deleteSorteo error", error);
    return response(500, { message: "Error interno al eliminar sorteo." });
  }
};

// ─── PARTICIPANTES ──────────────────────────────────────────────────────────────

const clearParticipantsOfSorteo = async (sorteoId) => {
  let items = [];
  let lastKey;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: PARTICIPANTES_TABLE,
        KeyConditionExpression: "sorteoId = :sid",
        ExpressionAttributeValues: { ":sid": sorteoId },
        ProjectionExpression: "sorteoId, dni",
        ExclusiveStartKey: lastKey,
      })
    );
    items = items.concat(result.Items || []);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  if (items.length === 0) return;

  const chunks = chunkArray(items, 25);
  for (const batch of chunks) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [PARTICIPANTES_TABLE]: batch.map((item) => ({
            DeleteRequest: {
              Key: { sorteoId: item.sorteoId, dni: item.dni },
            },
          })),
        },
      })
    );
  }

  // Reset participant count
  await docClient.send(
    new UpdateCommand({
      TableName: SORTEOS_TABLE,
      Key: { sorteoId },
      UpdateExpression: "SET participantCount = :zero",
      ExpressionAttributeValues: { ":zero": 0 },
    })
  );
};

const clearSorteoParticipants = async (event, sorteoId) => {
  if (!validateAdmin(event)) {
    return response(401, { message: "Clave de administrador incorrecta." });
  }

  try {
    await clearParticipantsOfSorteo(sorteoId);
    return response(200, { message: "Participantes del sorteo eliminados." });
  } catch (error) {
    console.error("clearSorteoParticipants error", error);
    return response(500, { message: "Error interno al vaciar participantes." });
  }
};

const registerParticipant = async (event, sorteoId) => {
  const payload = safeJsonParse(event.body);
  if (!payload) {
    return response(400, { message: "Body JSON invalido." });
  }

  const firstName = String(payload.firstName || "").trim();
  const lastName = String(payload.lastName || "").trim();
  const dni = String(payload.dni || "").trim();

  if (!firstName || !lastName || !dni) {
    return response(400, { message: "Campos requeridos: firstName, lastName, dni." });
  }

  // Verify sorteo exists and is open
  try {
    const sorteoResult = await docClient.send(
      new GetCommand({
        TableName: SORTEOS_TABLE,
        Key: { sorteoId },
      })
    );

    if (!sorteoResult.Item) {
      return response(404, { message: "Sorteo no encontrado." });
    }

    if (sorteoResult.Item.status !== "open") {
      return response(400, { message: "Este sorteo esta cerrado." });
    }
  } catch (error) {
    console.error("registerParticipant sorteo check error", error);
    return response(500, { message: "Error interno." });
  }

  try {
    await docClient.send(
      new PutCommand({
        TableName: PARTICIPANTES_TABLE,
        Item: {
          sorteoId,
          dni,
          firstName,
          lastName,
          createdAt: new Date().toISOString(),
        },
        ConditionExpression: "attribute_not_exists(dni)",
      })
    );

    // Increment participant count
    await docClient.send(
      new UpdateCommand({
        TableName: SORTEOS_TABLE,
        Key: { sorteoId },
        UpdateExpression: "ADD participantCount :inc",
        ExpressionAttributeValues: { ":inc": 1 },
      })
    );

    return response(201, { message: "Registro exitoso." });
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      return response(400, { message: "Este DNI ya esta registrado en este sorteo." });
    }
    console.error("registerParticipant error", error);
    return response(500, { message: "Error interno al registrar participante." });
  }
};

const listParticipants = async (sorteoId) => {
  try {
    let items = [];
    let lastKey;

    do {
      const result = await docClient.send(
        new QueryCommand({
          TableName: PARTICIPANTES_TABLE,
          KeyConditionExpression: "sorteoId = :sid",
          ExpressionAttributeValues: { ":sid": sorteoId },
          ExclusiveStartKey: lastKey,
        })
      );
      items = items.concat(result.Items || []);
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return response(200, { count: items.length, participants: items });
  } catch (error) {
    console.error("listParticipants error", error);
    return response(500, { message: "Error interno al listar participantes." });
  }
};

// ─── ROUTER ─────────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const path = event.path || "";
  const method = event.httpMethod || "";

  if (method === "OPTIONS") {
    return response(200, { message: "CORS OK" });
  }

  // GET /sorteos - list all
  if (method === "GET" && path.match(/\/sorteos\/?$/)) {
    return listSorteos();
  }

  // POST /sorteos - create
  if (method === "POST" && path.match(/\/sorteos\/?$/)) {
    return createSorteo(event);
  }

  // GET /sorteos/{id} - get single
  const getSorteoMatch = path.match(/\/sorteos\/([^/]+)\/?$/);
  if (method === "GET" && getSorteoMatch) {
    return getSorteo(getSorteoMatch[1]);
  }

  // DELETE /sorteos/{id} - delete sorteo
  const deleteSorteoMatch = path.match(/\/sorteos\/([^/]+)\/?$/);
  if (method === "DELETE" && deleteSorteoMatch) {
    return deleteSorteo(event, deleteSorteoMatch[1]);
  }

  // PATCH /sorteos/{id}/close
  const closeMatch = path.match(/\/sorteos\/([^/]+)\/close\/?$/);
  if (method === "PATCH" && closeMatch) {
    return updateSorteoStatus(event, closeMatch[1], "closed");
  }

  // PATCH /sorteos/{id}/reopen
  const reopenMatch = path.match(/\/sorteos\/([^/]+)\/reopen\/?$/);
  if (method === "PATCH" && reopenMatch) {
    return updateSorteoStatus(event, reopenMatch[1], "open");
  }

  // DELETE /sorteos/{id}/participantes - clear participants
  const clearMatch = path.match(/\/sorteos\/([^/]+)\/participantes\/?$/);
  if (method === "DELETE" && clearMatch) {
    return clearSorteoParticipants(event, clearMatch[1]);
  }

  // GET /sorteos/{id}/participantes - list participants
  const listPartMatch = path.match(/\/sorteos\/([^/]+)\/participantes\/?$/);
  if (method === "GET" && listPartMatch) {
    return listParticipants(listPartMatch[1]);
  }

  // POST /sorteos/{id}/participantes - register participant
  const regMatch = path.match(/\/sorteos\/([^/]+)\/participantes\/?$/);
  if (method === "POST" && regMatch) {
    return registerParticipant(event, regMatch[1]);
  }

  return response(404, { message: "Ruta no encontrada." });
};
