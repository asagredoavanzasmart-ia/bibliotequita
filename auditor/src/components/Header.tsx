import { BookOpen } from 'lucide-react';

export function Header() {
  return (
    <header className="sticky top-0 z-10 bg-white dark:bg-slate-900/80 backdrop-blur border-b border-slate-200 dark:border-slate-800">
      <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="bg-indigo-600 w-8 h-8 rounded-sm flex items-center justify-center text-white">
            <BookOpen className="w-5 h-5" />
          </div>
          <span className="font-bold text-xl tracking-tight text-slate-900 dark:text-white">
            Auditor<span className="text-indigo-600 dark:text-indigo-400">Científico</span>
          </span>
        </div>
      </div>
    </header>
  );
}
