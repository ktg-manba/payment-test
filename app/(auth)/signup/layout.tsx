export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata = {
  title: '注册',
  description: 'AI编程学习平台注册页面',
}

export default function SignUpLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
} 