/**
 * Server-side NIC / GSP e-Invoice REST adapter (`AUTODINE_IRP_PROVIDER=nic_gsp`).
 *
 * SECURITY INVARIANTS:
 * - Credentials exist ONLY in server environment variables (`process.env`),
 *   never in browser code, database tables, or the local Print Bridge.
 * - Fails closed if any required credential is missing.
 * - Never logs secrets, passwords, or auth tokens.
 * - Aborts slow IRP calls at 8 seconds so POS checkout never hangs.
 */

import type {
  IrpAdapter,
  IrpCancelOutcome,
  IrpCancelReason,
  IrpOutcome,
  IrpPayloadV1,
} from './types';

export const NIC_GSP_PROVIDER_ID = 'nic_gsp';

export type NicGspConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  sellerGstin?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type TokenCache = {
  token: string;
  sek?: string;
  expiresAtMs: number;
};

const paiseToRupeesNum = (paise: number): number => Math.round(paise) / 100;

function formatNicDate(isoYyyyMmDd: string): string {
  const [y, m, d] = isoYyyyMmDd.split('-');
  if (!y || !m || !d) return isoYyyyMmDd;
  return `${d}/${m}/${y}`;
}

export function toNicEinvoiceV103(payload: IrpPayloadV1): Record<string, unknown> {
  return {
    Version: '1.1',
    TranDtls: {
      TaxSch: 'GST',
      SupTyp: payload.supplyType,
      RegRev: 'N',
      IgstOnIntra: 'N',
    },
    DocDtls: {
      Typ: payload.documentType,
      No: payload.documentNumber,
      Dt: formatNicDate(payload.issuedDate),
    },
    SellerDtls: {
      Gstin: payload.seller.gstin,
      LglNm: payload.seller.legalName,
      TrdNm: payload.seller.tradeName ?? payload.seller.legalName,
      Addr1: payload.seller.address1,
      ...(payload.seller.address2 ? { Addr2: payload.seller.address2 } : {}),
      Loc: payload.seller.location,
      Pin: Number.parseInt(payload.seller.pincode, 10) || 400001,
      Stcd: payload.seller.stateCode,
      ...(payload.seller.phone ? { Ph: payload.seller.phone } : {}),
      ...(payload.seller.email ? { Em: payload.seller.email } : {}),
    },
    ...(payload.buyer
      ? {
          BuyerDtls: {
            Gstin: payload.buyer.gstin,
            LglNm: payload.buyer.legalName,
            Pos: payload.buyer.placeOfSupplyStateCode,
            Addr1: payload.buyer.address1,
            ...(payload.buyer.address2 ? { Addr2: payload.buyer.address2 } : {}),
            Loc: payload.buyer.location,
            Pin: Number.parseInt(payload.buyer.pincode, 10) || 400001,
            Stcd: payload.buyer.stateCode,
            ...(payload.buyer.phone ? { Ph: payload.buyer.phone } : {}),
            ...(payload.buyer.email ? { Em: payload.buyer.email } : {}),
          },
        }
      : {}),
    ItemList: payload.lines.map((line, index) => ({
      SlNo: String(index + 1),
      PrdDesc: line.itemName,
      IsServc: line.hsnSac.startsWith('99') ? 'Y' : 'N',
      HsnCd: line.hsnSac,
      Qty: line.quantity,
      Unit: line.uom,
      UnitPrice: paiseToRupeesNum(line.unitPricePaise),
      TotAmt: paiseToRupeesNum(line.grossAmountPaise),
      Discount: paiseToRupeesNum(line.discountPaise),
      AssAmt: paiseToRupeesNum(line.taxablePaise),
      GstRt: paiseToRupeesNum(line.rateBps),
      CgstAmt: paiseToRupeesNum(line.cgstPaise),
      SgstAmt: paiseToRupeesNum(line.sgstPaise),
      IgstAmt: paiseToRupeesNum(line.igstPaise),
      TotItemVal: paiseToRupeesNum(line.totalItemValuePaise),
    })),
    ValDtls: {
      AssVal: paiseToRupeesNum(payload.values.taxablePaise),
      CgstVal: paiseToRupeesNum(payload.values.cgstPaise),
      SgstVal: paiseToRupeesNum(payload.values.sgstPaise),
      IgstVal: paiseToRupeesNum(payload.values.igstPaise),
      OthChrg: paiseToRupeesNum(payload.values.otherChargesPaise),
      TotInvVal: paiseToRupeesNum(payload.values.totalPaise),
    },
  };
}

export function resolveNicGspConfig(env: NodeJS.ProcessEnv = process.env):
  | { ok: true; config: NicGspConfig }
  | { ok: false; error: string } {
  const baseUrl = env.AUTODINE_IRP_BASE_URL?.trim().replace(/\/+$/, '') ?? '';
  const clientId = env.AUTODINE_IRP_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.AUTODINE_IRP_CLIENT_SECRET?.trim() ?? '';
  const username = env.AUTODINE_IRP_USERNAME?.trim() ?? '';
  const password = env.AUTODINE_IRP_PASSWORD?.trim() ?? '';

  const missing: string[] = [];
  if (!baseUrl) missing.push('AUTODINE_IRP_BASE_URL');
  if (!clientId) missing.push('AUTODINE_IRP_CLIENT_ID');
  if (!clientSecret) missing.push('AUTODINE_IRP_CLIENT_SECRET');
  if (!username) missing.push('AUTODINE_IRP_USERNAME');
  if (!password) missing.push('AUTODINE_IRP_PASSWORD');

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Live GSP e-Invoicing requires server environment variable(s): ${missing.join(', ')}.`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { ok: false, error: 'AUTODINE_IRP_BASE_URL is not a valid URL.' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'AUTODINE_IRP_BASE_URL must use HTTPS.' };
  }

  return {
    ok: true,
    config: {
      baseUrl,
      clientId,
      clientSecret,
      username,
      password,
      sellerGstin: env.AUTODINE_IRP_GSTIN?.trim() || undefined,
    },
  };
}

export class NicGspIrpAdapter implements IrpAdapter {
  readonly providerId = NIC_GSP_PROVIDER_ID;
  private readonly cfg: NicGspConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private tokenCache: TokenCache | null = null;

  constructor(cfg: NicGspConfig) {
    this.cfg = cfg;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? 8000;
  }

  private async authenticate(gstin: string): Promise<{ ok: true; token: string } | { ok: false; code: string; message: string }> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAtMs > now + 30_000) {
      return { ok: true, token: this.tokenCache.token };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.cfg.baseUrl}/eivital/v1.04/auth`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          client_id: this.cfg.clientId,
          client_secret: this.cfg.clientSecret,
          gstin,
        },
        body: JSON.stringify({
          UserName: this.cfg.username,
          Password: this.cfg.password,
          ForceRefreshAccessToken: false,
        }),
        signal: controller.signal,
      });

      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const data = (body.Data && typeof body.Data === 'object' ? body.Data : body) as Record<string, unknown>;
      const token = typeof data.AuthToken === 'string' ? data.AuthToken : '';
      if (!res.ok || body.Status === 0 || !token) {
        const errList = Array.isArray(body.ErrorDetails) ? body.ErrorDetails : [];
        const first = (errList[0] ?? {}) as Record<string, unknown>;
        return {
          ok: false,
          code: String(first.ErrorCode ?? `AUTH-${res.status}`),
          message: String(first.ErrorMessage ?? body.ErrorMessage ?? 'IRP authentication failed.'),
        };
      }

      const tokenExpiryIso = typeof data.TokenExpiry === 'string' ? data.TokenExpiry : '';
      const parsedExpiry = tokenExpiryIso ? Date.parse(tokenExpiryIso) : NaN;
      this.tokenCache = {
        token,
        expiresAtMs: Number.isFinite(parsedExpiry) ? parsedExpiry : now + 5 * 60 * 60 * 1000,
      };
      return { ok: true, token };
    } catch (error) {
      return {
        ok: false,
        code: 'ADAPTER-EXCEPTION',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async generateIrn(payload: IrpPayloadV1): Promise<IrpOutcome> {
    const gstin = this.cfg.sellerGstin || payload.seller.gstin;
    const auth = await this.authenticate(gstin);
    if (!auth.ok) return auth;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.cfg.baseUrl}/eicore/v1.03/Invoice`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          client_id: this.cfg.clientId,
          client_secret: this.cfg.clientSecret,
          gstin,
          user_name: this.cfg.username,
          AuthToken: auth.token,
        },
        body: JSON.stringify(toNicEinvoiceV103(payload)),
        signal: controller.signal,
      });

      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const data = (body.Data && typeof body.Data === 'object' ? body.Data : body) as Record<string, unknown>;
      const irn = typeof data.Irn === 'string' ? data.Irn.toLowerCase() : '';
      const signedQrCode = typeof data.SignedQRCode === 'string' ? data.SignedQRCode : '';

      if (!res.ok || body.Status === 0 || !/^[0-9a-f]{64}$/.test(irn) || !signedQrCode) {
        const errList = Array.isArray(body.ErrorDetails) ? body.ErrorDetails : [];
        const first = (errList[0] ?? {}) as Record<string, unknown>;
        return {
          ok: false,
          code: String(first.ErrorCode ?? `IRP-${res.status}`),
          message: String(first.ErrorMessage ?? body.ErrorMessage ?? 'IRP rejected the e-Invoice payload.'),
        };
      }

      const ackNoNum = Number(data.AckNo ?? 0);
      const ackDt = typeof data.AckDt === 'string' && data.AckDt ? new Date(data.AckDt).toISOString() : new Date().toISOString();

      return {
        ok: true,
        ack: {
          irn,
          ackNo: Number.isFinite(ackNoNum) ? ackNoNum : 0,
          ackDateIso: Number.isNaN(Date.parse(ackDt)) ? new Date().toISOString() : ackDt,
          signedQrCode,
          signedInvoice: typeof data.SignedInvoice === 'string' ? data.SignedInvoice : '',
        },
      };
    } catch (error) {
      return {
        ok: false,
        code: 'ADAPTER-EXCEPTION',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async cancelIrn(input: { irn: string; reason: IrpCancelReason; remark: string }): Promise<IrpCancelOutcome> {
    const gstin = this.cfg.sellerGstin ?? '';
    const auth = await this.authenticate(gstin);
    if (!auth.ok) return auth;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.cfg.baseUrl}/eicore/v1.03/Invoice/Cancel`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          client_id: this.cfg.clientId,
          client_secret: this.cfg.clientSecret,
          ...(gstin ? { gstin } : {}),
          user_name: this.cfg.username,
          AuthToken: auth.token,
        },
        body: JSON.stringify({
          Irn: input.irn,
          CnlRsn: input.reason,
          CnlRem: input.remark,
        }),
        signal: controller.signal,
      });

      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const data = (body.Data && typeof body.Data === 'object' ? body.Data : body) as Record<string, unknown>;
      if (!res.ok || body.Status === 0) {
        const errList = Array.isArray(body.ErrorDetails) ? body.ErrorDetails : [];
        const first = (errList[0] ?? {}) as Record<string, unknown>;
        return {
          ok: false,
          code: String(first.ErrorCode ?? `IRP-CANCEL-${res.status}`),
          message: String(first.ErrorMessage ?? body.ErrorMessage ?? 'IRP rejected the cancellation.'),
        };
      }

      const cancelIso =
        typeof data.CancelDate === 'string' && data.CancelDate
          ? new Date(data.CancelDate).toISOString()
          : new Date().toISOString();

      return {
        ok: true,
        cancelDateIso: Number.isNaN(Date.parse(cancelIso)) ? new Date().toISOString() : cancelIso,
      };
    } catch (error) {
      return {
        ok: false,
        code: 'ADAPTER-EXCEPTION',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
