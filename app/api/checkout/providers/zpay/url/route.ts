import { NextResponse } from "next/server";
import crypto from "crypto";
import { createServerAdminClient, createServerSupabaseClient } from "@/utils/supabase/server";

type RequestBody = {
  productId: string;
  productName: string;
  amount: string; // 保留两位小数的字符串
  isSubscription?: boolean;
  subscriptionPeriod?: "monthly" | "yearly";
  type: "alipay" | "wxpay";
  param?: string;
};

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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;
    const {
      productId,
      productName,
      amount,
      isSubscription,
      subscriptionPeriod,
      type,
      param,
    } = body;

    if (!productId || !productName || !amount || !type) {
      return NextResponse.json(
        { error: "缺少必要参数" },
        { status: 400 }
      );
    }

    const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL;
    const ZPAY_PID = process.env.ZPAY_PID;
    const ZPAY_KEY = process.env.ZPAY_KEY;
    if (!BASE_URL || !ZPAY_PID || !ZPAY_KEY) {
      return NextResponse.json(
        { error: "服务端环境变量未配置完整" },
        { status: 500 }
      );
    }

    // 创建订单号：YYYYMMDDHHmmss + 随机三位数
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const rand = String(Math.floor(Math.random() * 900) + 100);
    const outTradeNo = `${y}${m}${d}${hh}${mm}${ss}${rand}`;

    const notifyUrl = `${BASE_URL}/api/checkout/providers/zpay/webhook`;
    const returnUrl = `${BASE_URL}/payment/success`;

    // 先写入数据库为 pending
    const supabaseAuth = createServerSupabaseClient();
    const { data: authUser, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !authUser?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const supabase = createServerAdminClient();
    const { error: insertErr } = await supabase.from("zpay_transactions").insert({
      user_id: authUser.user.id,
      product_id: productId,
      amount: amount,
      currency: "CNY",
      out_trade_no: outTradeNo,
      status: "pending",
      is_subscription: !!isSubscription,
      subscription_period: isSubscription ? subscriptionPeriod : null,
      name: productName,
      pid: ZPAY_PID,
      type,
      param: param ?? null,
    });

    if (insertErr) {
      return NextResponse.json(
        { error: "创建交易记录失败", detail: insertErr.message },
        { status: 500 }
      );
    }

    // 按文档拼接签名参数
    const params: Record<string, string> = {
      name: productName,
      money: amount,
      type,
      out_trade_no: outTradeNo,
      notify_url: notifyUrl,
      pid: ZPAY_PID,
      return_url: returnUrl,
      sign_type: "MD5",
    };
    if (param) params.param = param;

    const preStr = buildPreSignString(params);
    const sign = md5Lower(preStr + ZPAY_KEY);

    const qs = new URLSearchParams({ ...params, sign, sign_type: "MD5" });
    const payUrl = `https://zpayz.cn/submit.php?${qs.toString()}`;

    return NextResponse.json({ payUrl, out_trade_no: outTradeNo });
  } catch (e: any) {
    return NextResponse.json(
      { error: "服务器错误", detail: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}


