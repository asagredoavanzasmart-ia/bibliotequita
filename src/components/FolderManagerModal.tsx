import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useLibrary } from '../hooks/useLibrary';
import { BookItem } from '../types';

interface Props {
  book: BookItem;
  onClose: () => void;
}

export function FolderManagerModal({ book, onClose }: Props) {
  const { playlists, stages, updateItem } = useLibrary();

  const toggleFolder = (id: string) => {
    const isSelected = book.folderIds.includes(id);
    const newIds = isSelected 
      ? book.folderIds.filter(fid => fid !== id)
      : [...book.folderIds, id];
    updateItem(book.id, { folderIds: newIds });
  };

  const toggleStage = (id: string) => {
    const isSelected = book.stageIds.includes(id);
    const newIds = isSelected 
      ? book.stageIds.filter(sid => sid !== id)
      : [...book.stageIds, id];
    updateItem(book.id, { stageIds: newIds });
  };

  const modalContent = (
    <div className="fixed inset-0 z-[1000] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <h3 className="font-bold text-lg text-slate-800">Organizar: {book.title}</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5"/></button>
        </div>
        
        <div className="p-6 space-y-6">
           <div>
             <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Asignar a Listas / Carpetas</h4>
             {playlists.length === 0 ? (
               <p className="text-sm text-slate-500 italic">No hay listas creadas.</p>
             ) : (
               <div className="space-y-2">
                 {playlists.map(pl => (
                   <label key={pl.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors border border-transparent hover:border-slate-200">
                     <input 
                       type="checkbox" 
                       checked={(book.folderIds || []).includes(pl.id)}
                       onChange={() => toggleFolder(pl.id)}
                       className="w-4 h-4 text-[#00558F] rounded border-slate-300 focus:ring-[#00558F]"
                     />
                     <div className={`w-3 h-3 rounded-full ${pl.color}`} />
                     <span className="text-sm font-medium text-slate-700">{pl.name}</span>
                   </label>
                 ))}
               </div>
             )}
           </div>

           <div>
             <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Etapas Históricas</h4>
             <div className="space-y-2">
                 {stages.map(st => (
                   <label key={st.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors border border-transparent hover:border-slate-200">
                     <input 
                       type="checkbox" 
                       checked={(book.stageIds || []).includes(st.id)}
                       onChange={() => toggleStage(st.id)}
                       className="w-4 h-4 text-[#00558F] rounded border-slate-300 focus:ring-[#00558F]"
                     />
                     <span className="text-sm font-medium text-slate-700">{st.name}</span>
                   </label>
                 ))}
               </div>
           </div>
        </div>
        
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-[#00558F] text-white text-sm font-medium rounded-lg hover:bg-[#004270] transition-colors">Listo</button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
