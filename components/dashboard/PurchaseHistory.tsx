"use client";

import { createClient } from "@/utils/supabase/client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Transaction {
  id: string;
  product_id: string;
  name: string | null;
  amount: string;
  currency: string;
  status: string;
  created_at: string;
  out_trade_no: string;
  zpay_trade_no: string | null;
  type: string | null;
  raw_notify: any;
}

interface Product {
  id: string;
  name: string;
  title: string;
  isSubscription?: boolean;
  subscriptionPeriod?: "monthly" | "yearly";
}

export default function PurchaseHistory() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const supabase = createClient();
        // 获取产品信息
        const productsRes = await fetch("/api/products");
        const productsData = await productsRes.json();
        setProducts(productsData.products);

        // 获取用户交易记录
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from("zpay_transactions")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (error) {
          console.error("获取交易记录失败:", error);
        } else {
          setTransactions(data || []);
        }
      } catch (error) {
        console.error("获取数据失败:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const getProductName = (productId: string): string => {
    const product = products[productId];
    return product?.name || product?.title || productId;
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusText = (status: string): string => {
    const statusMap: Record<string, string> = {
      pending: "待支付",
      success: "支付成功",
      failed: "支付失败",
      cancelled: "已取消",
    };
    return statusMap[status] || status;
  };

  const getStatusColor = (status: string): string => {
    const colorMap: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800",
      success: "bg-green-100 text-green-800",
      failed: "bg-red-100 text-red-800",
      cancelled: "bg-gray-100 text-gray-800",
    };
    return colorMap[status] || "bg-gray-100 text-gray-800";
  };

  const handleAction = async (transaction: Transaction) => {
    if (transaction.status === "pending") {
      // 待支付状态，重新生成支付链接并跳转
      try {
        const product = products[transaction.product_id];
        if (!product) {
          alert("产品信息不存在");
          return;
        }

        const isSubscription = product.isSubscription || false;
        const subscriptionPeriod = (product as any).subscriptionPeriod as
          | "monthly"
          | "yearly"
          | undefined;

        const resp = await fetch("/api/checkout/providers/zpay/url", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            productId: transaction.product_id,
            productName: transaction.name || product.name,
            amount: transaction.amount,
            isSubscription,
            subscriptionPeriod,
            type: transaction.type || "alipay",
          }),
        });

        const data = await resp.json();
        if (data.payUrl) {
          window.location.href = data.payUrl;
        } else {
          alert(data.error || "生成支付链接失败");
        }
      } catch (error) {
        console.error("跳转支付失败:", error);
        alert("跳转支付失败");
      }
    } else if (transaction.status === "success") {
      // 支付成功，显示订单详情
      const details = [
        `订单号: ${transaction.out_trade_no}`,
        `交易号: ${transaction.zpay_trade_no || "无"}`,
        `产品名称: ${getProductName(transaction.product_id)}`,
        `金额: ¥${transaction.amount} ${transaction.currency}`,
        `支付方式: ${transaction.type === "alipay" ? "支付宝" : transaction.type === "wxpay" ? "微信支付" : transaction.type || "未知"}`,
        `购买日期: ${formatDate(transaction.created_at)}`,
        `状态: ${getStatusText(transaction.status)}`,
      ];

      if (transaction.raw_notify) {
        details.push(`\n原始回调数据:\n${JSON.stringify(transaction.raw_notify, null, 2)}`);
      }

      alert(details.join("\n"));
    }
  };

  if (loading) {
    return (
      <div className="mb-8 bg-white p-6 rounded-lg shadow-sm">
        <h2 className="h3 font-cabinet-grotesk mb-4">购买历史</h2>
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="mb-8 bg-white p-6 rounded-lg shadow-sm">
        <h2 className="h3 font-cabinet-grotesk mb-4">购买历史</h2>
        <p className="text-gray-500">暂无购买记录</p>
      </div>
    );
  }

  return (
    <div className="mb-8 bg-white p-6 rounded-lg shadow-sm">
      <h2 className="h3 font-cabinet-grotesk mb-4">购买历史</h2>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-3 px-4 font-medium text-gray-700">产品名称</th>
              <th className="text-left py-3 px-4 font-medium text-gray-700">购买日期</th>
              <th className="text-left py-3 px-4 font-medium text-gray-700">价格</th>
              <th className="text-left py-3 px-4 font-medium text-gray-700">状态</th>
              <th className="text-left py-3 px-4 font-medium text-gray-700">操作</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction) => (
              <tr key={transaction.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-3 px-4">
                  {getProductName(transaction.product_id)}
                </td>
                <td className="py-3 px-4 text-gray-600">
                  {formatDate(transaction.created_at)}
                </td>
                <td className="py-3 px-4 font-medium">
                  ¥{transaction.amount} {transaction.currency}
                </td>
                <td className="py-3 px-4">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(
                      transaction.status
                    )}`}
                  >
                    {getStatusText(transaction.status)}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <button
                    onClick={() => handleAction(transaction)}
                    className={`text-sm px-3 py-1 rounded ${
                      transaction.status === "pending"
                        ? "bg-blue-600 text-white hover:bg-blue-700"
                        : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                    }`}
                  >
                    {transaction.status === "pending" ? "去支付" : "查看详情"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

