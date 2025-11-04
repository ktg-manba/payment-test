"use client";

import { createClient } from "@/utils/supabase/client";
import { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useEffect, useState } from "react";
import PurchaseHistory from "@/components/dashboard/PurchaseHistory";

interface Subscription {
  id: string;
  product_id: string;
  name: string | null;
  subscription_period: string | null;
  start_at: string | null;
  end_at: string | null;
}

interface DashboardClientProps {
  user?: User | null;
  subscription?: Subscription | null;
}

export default function DashboardClient({ user, subscription: initialSubscription }: DashboardClientProps) {
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(initialSubscription || null);

  // 如果props中的user为undefined，尝试从客户端获取用户
  useEffect(() => {
    const getUserFromClient = async () => {
      console.log("user", user);
      
      if (initialSubscription) {
        setSubscription(initialSubscription);
      }

      if (user) {
        setCurrentUser(user);
        setLoading(false);
        return;
      }

      try {
        const supabase = createClient();
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser();
        setCurrentUser(authUser);
      } catch (error) {
        console.error("获取用户信息失败:", error);
      } finally {
        setLoading(false);
      }
    };

    getUserFromClient();
  }, [user, initialSubscription]);

  const formatSubscriptionDate = (dateString: string | null): string => {
    if (!dateString) return "未知";
    const date = new Date(dateString);
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  const getSubscriptionPeriodText = (period: string | null): string => {
    if (period === "monthly") return "月付";
    if (period === "yearly") return "年付";
    return "订阅";
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  // 显示加载状态
  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-center items-center min-h-[40vh]">
          <p className="text-gray-500">加载用户信息中...</p>
        </div>
      </div>
    );
  }

  // 用户未登录
  if (!currentUser) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col justify-center items-center min-h-[40vh]">
          <p className="text-gray-500 mb-4">您尚未登录或会话已过期</p>
          <Link
            href="/signin?redirect=/dashboard"
            className="btn-sm text-white bg-blue-600 hover:bg-blue-700 shadow-sm"
          >
            登录
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* 用户信息 */}
      <div className="mb-8 bg-white p-6 rounded-lg shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-start">
          <div>
            <h2 className="h3 font-cabinet-grotesk mb-2">个人信息</h2>
            <p className="text-gray-600 mb-2">
              <span className="font-medium">邮箱:</span> {currentUser.email}
            </p>
            {subscription ? (
              <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-sm font-medium text-blue-900 mb-1">
                  当前订阅: {subscription.name || "专业版"}
                </p>
                <p className="text-xs text-blue-700">
                  {getSubscriptionPeriodText(subscription.subscription_period)} | 
                  开始时间: {formatSubscriptionDate(subscription.start_at)} | 
                  到期时间: {formatSubscriptionDate(subscription.end_at)}
                </p>
              </div>
            ) : (
              <p className="text-gray-500 text-sm mt-2">暂无有效订阅</p>
            )}
          </div>
          <div className="mt-4 md:mt-0">
            <button
              onClick={handleSignOut}
              className="btn-sm text-white bg-red-500 hover:bg-red-600 shadow-sm"
            >
              退出登录
            </button>
          </div>
        </div>
      </div>

      {/* 购买历史 */}
      <PurchaseHistory />
    </div>
  );
}
