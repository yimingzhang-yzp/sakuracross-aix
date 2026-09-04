export function PeriodStatus({ status }: { status: string }) {
  switch (status) {
    case 'COLLECTING':
      return <span className="badge info">希望回収中</span>;
    case 'GENERATING':
      return <span className="badge warn">生成・調整中</span>;
    case 'CONFIRMED':
      return <span className="badge ok">確定</span>;
    default:
      return <span className="badge">{status}</span>;
  }
}
