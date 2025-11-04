import { NextResponse } from "next/server";
import crypto from "crypto";
import { createServerAdminClient } from "@/utils/supabase/server";

function buildPreSignString(params: Record<string, string | undefined>) {
  const pairs: [string, string][] = [];
  for (const key in params) {
    const value = params[key];
    if (!value || key === "sign" || key === "sign_type") continue;
    pairs.push([key, value]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

function md5Lower(input: string) {
  return crypto.createHash("md5").update(input, "utf8").digest("hex");
}

// 从请求中提取参数（支持 GET 和 POST）
async function extractParams(req: Request): Promise<Record<string, string | undefined>> {
  const url = new URL(req.url);
  const search = url.searchParams;
  
  // 如果是 POST 请求，尝试从请求体读取
  if (req.method === "POST") {
    try {
      const contentType = req.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const body = await req.json();
        return {
          pid: body.pid || search.get("pid") || undefined,
          name: body.name || search.get("name") || undefined,
          money: body.money || search.get("money") || undefined,
          out_trade_no: body.out_trade_no || search.get("out_trade_no") || undefined,
          trade_no: body.trade_no || search.get("trade_no") || undefined,
          param: body.param || search.get("param") || undefined,
          trade_status: body.trade_status || search.get("trade_status") || undefined,
          type: body.type || search.get("type") || undefined,
          sign: body.sign || search.get("sign") || undefined,
          sign_type: body.sign_type || search.get("sign_type") || undefined,
        };
      } else if (contentType.includes("application/x-www-form-urlencoded")) {
        const formData = await req.formData();
        return {
          pid: formData.get("pid")?.toString() || search.get("pid") || undefined,
          name: formData.get("name")?.toString() || search.get("name") || undefined,
          money: formData.get("money")?.toString() || search.get("money") || undefined,
          out_trade_no: formData.get("out_trade_no")?.toString() || search.get("out_trade_no") || undefined,
          trade_no: formData.get("trade_no")?.toString() || search.get("trade_no") || undefined,
          param: formData.get("param")?.toString() || search.get("param") || undefined,
          trade_status: formData.get("trade_status")?.toString() || search.get("trade_status") || undefined,
          type: formData.get("type")?.toString() || search.get("type") || undefined,
          sign: formData.get("sign")?.toString() || search.get("sign") || undefined,
          sign_type: formData.get("sign_type")?.toString() || search.get("sign_type") || undefined,
        };
      }
    } catch (e) {
      // 如果解析失败，回退到 URL 参数
    }
  }
  
  // GET 请求或 POST 请求回退：从 URL 参数读取
  return {
    pid: search.get("pid") || undefined,
    name: search.get("name") || undefined,
    money: search.get("money") || undefined,
    out_trade_no: search.get("out_trade_no") || undefined,
    trade_no: search.get("trade_no") || undefined,
    param: search.get("param") || undefined,
    trade_status: search.get("trade_status") || undefined,
    type: search.get("type") || undefined,
    sign: search.get("sign") || undefined,
    sign_type: search.get("sign_type") || undefined,
  };
}

// 处理 webhook 的核心逻辑
async function handleWebhook(req: Request) {
  const payload = await extractParams(req);
  
  console.log("[Webhook] 收到请求:", {
    method: req.method,
    url: req.url,
    payload: payload,
  });

  try {
    const ZPAY_KEY = process.env.ZPAY_KEY;
    if (!ZPAY_KEY) {
      console.error("[Webhook] 环境变量 ZPAY_KEY 未配置");
      return new NextResponse("env error", { status: 500 });
    }

    // 检查必要参数
    if (!payload.out_trade_no) {
      console.error("[Webhook] 缺少 out_trade_no 参数");
      return new NextResponse("missing out_trade_no", { status: 400 });
    }

    // 1) 验签
    const pre = buildPreSignString({ ...payload } as any);
    const localSign = md5Lower(pre + ZPAY_KEY);
    console.log("[Webhook] 验签:", {
      preString: pre,
      receivedSign: payload.sign,
      localSign: localSign,
    });
    
    if (!payload.sign || localSign !== payload.sign) {
      console.error("[Webhook] 验签失败");
      return new NextResponse("invalid sign", { status: 400 });
    }

    // 2) 查询订单
    const supabase = createServerAdminClient();
    const { data: tx, error: txErr } = await supabase
      .from("zpay_transactions")
      .select("*")
      .eq("out_trade_no", payload.out_trade_no!)
      .maybeSingle();

    console.log("[Webhook] 查询订单:", {
      out_trade_no: payload.out_trade_no,
      found: !!tx,
      error: txErr?.message,
      currentStatus: tx?.status,
    });

    if (txErr) {
      console.error("[Webhook] 查询订单错误:", txErr);
      return new NextResponse(`query error: ${txErr.message}`, { status: 500 });
    }
    
    if (!tx) {
      console.error("[Webhook] 订单不存在:", payload.out_trade_no);
      return new NextResponse("not found", { status: 404 });
    }

    // 3) 幂等：如果已成功，直接返回 success
    if (tx.status === "success") {
      console.log("[Webhook] 订单已是成功状态，直接返回");
      return new NextResponse("success", { status: 200 });
    }

    // 4) 金额校验
    if (!payload.money || Number(payload.money).toFixed(2) !== Number(tx.amount).toFixed(2)) {
      console.error("[Webhook] 金额不匹配:", {
        received: payload.money,
        expected: tx.amount,
      });
      return new NextResponse("amount mismatch", { status: 400 });
    }

    // 5) 仅当状态成功时才入账
    if (payload.trade_status !== "TRADE_SUCCESS") {
      console.log("[Webhook] 交易状态不是成功，忽略:", payload.trade_status);
      return new NextResponse("ignored", { status: 200 });
    }

    // 6) 订阅起止时间计算（避免重复订阅重叠）
    let startAt: string | null = null;
    let endAt: string | null = null;

    if (tx.is_subscription) {
      // 查找该用户该产品最近一次成功的订阅结束时间
      const { data: lastSubs, error: lastSubsErr } = await supabase
        .from("zpay_transactions")
        .select("end_at")
        .eq("user_id", tx.user_id)
        .eq("product_id", tx.product_id)
        .eq("is_subscription", true)
        .eq("status", "success")
        .order("end_at", { ascending: false })
        .limit(1);

      if (lastSubsErr) {
        console.error("[Webhook] 查询上次订阅错误:", lastSubsErr);
      }

      const now = new Date();
      const baseStart = lastSubs && lastSubs.length && lastSubs[0].end_at
        ? new Date(lastSubs[0].end_at)
        : now;

      // 如果上次还未过期，新的订阅从上次结束时间开始；否则从当前时间开始
      const effectiveStart = baseStart > now ? baseStart : now;
      startAt = effectiveStart.toISOString();

      const end = new Date(effectiveStart);
      if (tx.subscription_period === "monthly") {
        end.setMonth(end.getMonth() + 1);
      } else if (tx.subscription_period === "yearly") {
        end.setFullYear(end.getFullYear() + 1);
      } else {
        // 默认按月
        end.setMonth(end.getMonth() + 1);
      }
      endAt = end.toISOString();
      
      console.log("[Webhook] 订阅时间计算:", {
        startAt,
        endAt,
        period: tx.subscription_period,
      });
    }

    // 7) 更新交易记录为 success
    const updateData = {
      status: "success",
      zpay_trade_no: payload.trade_no ?? null,
      type: payload.type ?? tx.type,
      raw_notify: payload as any,
      start_at: startAt,
      end_at: endAt,
    };
    
    console.log("[Webhook] 准备更新订单:", {
      id: tx.id,
      updateData,
    });

    const { data: updatedTx, error: updErr } = await supabase
      .from("zpay_transactions")
      .update(updateData)
      .eq("id", tx.id)
      .select();

    if (updErr) {
      console.error("[Webhook] 更新订单失败:", updErr);
      return new NextResponse(`update error: ${updErr.message}`, { status: 500 });
    }

    console.log("[Webhook] 订单更新成功:", updatedTx);
    return new NextResponse("success", { status: 200 });
  } catch (e: any) {
    console.error("[Webhook] 处理异常:", e);
    console.error("[Webhook] 错误堆栈:", e?.stack);
    return new NextResponse(`error: ${e?.message || String(e)}`, { status: 500 });
  }
}

// 支持 GET 和 POST 方法
export async function GET(req: Request) {
  return handleWebhook(req);
}

export async function POST(req: Request) {
  return handleWebhook(req);
}


