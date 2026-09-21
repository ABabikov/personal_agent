import {
  MaxClient,
  MemorySessionStore,
  Opcode,
  RawTransport,
  qrBindWebSession,
  sendPhoneAuthCode,
  verifyPhoneAuthCode,
} from "max-account-api";
import type { MaxChatOption } from "./types";
import {
  loadPendingSms,
  normalizeMaxPhone,
  saveMaxSession,
  savePendingSms,
  summarizeChats,
} from "./session";

function mapMaxLoginError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (/unsupported-version/i.test(message)) {
    return new Error("Max отклонил версию клиента. Подождите минуту и нажмите ещё раз — на сервере обновляется патч.");
  }
  if (/region|unavailable|phone\.region/i.test(message)) {
    return new Error("Max не шлёт SMS с этого сервера (другой регион). Напишите, обойдём.");
  }
  return err instanceof Error ? err : new Error(message);
}

export async function sendMaxSms(phoneRaw: string) {
  const phone = normalizeMaxPhone(phoneRaw);
  if (!phone || phone.length < 12) {
    throw new Error("Нужен номер в формате +79991234567");
  }

  const store = new MemorySessionStore();
  const sess = await store.load();
  const raw = new RawTransport();
  await raw.connect();
  try {
    await raw.hello(sess.mobileDeviceId!, sess.mtInstanceId!).catch((err) => {
      throw mapMaxLoginError(err);
    });
    const start = await sendPhoneAuthCode(raw, phone).catch((err) => {
      throw mapMaxLoginError(err);
    });
    await savePendingSms({
      smsToken: start.token,
      deviceId: sess.deviceId,
      mobileDeviceId: sess.mobileDeviceId!,
      mtInstanceId: sess.mtInstanceId!,
    });
    return { ok: true as const, phone, codeLength: start.codeLength ?? 6, ttl: start.ttl ?? 60 };
  } finally {
    raw.close();
  }
}

export async function verifyMaxSms(codeRaw: string, password?: string) {
  const code = codeRaw.replace(/\D/g, "");
  if (!code) throw new Error("Введите код из SMS");

  const pending = await loadPendingSms();
  if (!pending) throw new Error("Сначала запросите SMS");

  const store = new MemorySessionStore({
    deviceId: pending.deviceId,
    mobileDeviceId: pending.mobileDeviceId,
    mtInstanceId: pending.mtInstanceId,
  });
  const sess = await store.load();
  const raw = new RawTransport();
  await raw.connect();
  try {
    await raw.hello(pending.mobileDeviceId, pending.mtInstanceId).catch((err) => {
      throw mapMaxLoginError(err);
    });
    const verify = await verifyPhoneAuthCode(raw, code, pending.smsToken).catch((err) => {
      throw mapMaxLoginError(err);
    });
    let mobileToken = verify.tokenAttrs?.LOGIN?.token;
    if (!mobileToken && verify.passwordChallenge) {
      if (!password) {
        throw new Error("У аккаунта облачный пароль Max — введите его и нажмите Войти ещё раз.");
      }
      const final = await raw.request<{ tokenAttrs?: { LOGIN?: { token?: string } } }>(
        Opcode.AUTH_QR_PASSWORD_LOGIN,
        { trackId: verify.passwordChallenge.trackId, password },
        { prependOpHint: 0x33, flags: 1 },
      );
      mobileToken = final.tokenAttrs?.LOGIN?.token;
      if (!mobileToken) {
        throw new Error("Облачный пароль не подошёл.");
      }
    }
    if (!mobileToken) throw new Error("Max не выдал токен. Проверьте код.");

    await raw.mobileLogin(mobileToken);
    const bind = await qrBindWebSession(raw, {
      webDeviceId: sess.deviceId,
      resolvePassword: password ? async () => password : undefined,
    });
    const next = {
      ...sess,
      deviceId: bind.webDeviceId,
      loginToken: bind.webToken,
      mobileLoginToken: mobileToken,
      ownerId: bind.loginResponse.profile.contact.id,
    };
    const ownerName = bind.loginResponse.profile.contact.names?.[0]?.name ?? null;
    await saveMaxSession(next, ownerName);

    const client = new MaxClient({
      session: new MemorySessionStore(next),
      printQr: false,
      printCredentialsAfterLogin: false,
      autoRead: false,
      chatsCount: 80,
    });
    await client.start();
    try {
      return {
        ok: true as const,
        ownerName,
        chats: summarizeChats(client.getChats()),
      };
    } finally {
      await client.stop();
    }
  } finally {
    raw.close();
  }
}

/** Привязка к уже открытому Max на телефоне: пользователь открывает ссылку в приложении. */
export async function loginMaxByLink(
  onLink: (link: string) => void,
  password?: string,
): Promise<{ ok: true; ownerName: string | null; chats: MaxChatOption[] }> {
  const store = new MemorySessionStore();
  const client = new MaxClient({
    session: store,
    printQr: false,
    printCredentialsAfterLogin: false,
    autoRead: false,
    chatsCount: 80,
    resolvePassword: password
      ? async () => password
      : async () => {
          throw new Error("Нужен облачный пароль Max. Введите его и нажмите ещё раз.");
        },
  });

  client.on("qr", (info) => {
    onLink(info.link);
  });

  await client.start();
  try {
    const sess = await store.load();
    const ownerName = client.getMe()?.names?.[0]?.name ?? null;
    await saveMaxSession(sess, ownerName);
    return { ok: true, ownerName, chats: summarizeChats(client.getChats()) };
  } finally {
    await client.stop();
  }
}
