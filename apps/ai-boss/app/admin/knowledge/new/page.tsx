import Link from 'next/link';

import { createKnowledgeDoc } from '../../actions';
import { DocForm } from '../doc-form';
import { CATEGORY_NAMES } from '@/lib/knowledge/categories';

export default function NewKnowledgeDocPage() {
  return (
    <>
      <div className="page-header">
        <h1>新規ドキュメント</h1>
        <Link href="/admin/knowledge">← 一覧へ</Link>
      </div>
      <div className="card">
        <DocForm action={createKnowledgeDoc} categories={CATEGORY_NAMES} submitLabel="作成する" showActiveToggle />
      </div>
    </>
  );
}
