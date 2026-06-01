import { useState, useRef } from 'react';
import { UploadCloud, File, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';

interface FileUploaderProps {
  onFileSelect: (file: File) => void;
  isProcessing: boolean;
  disabled?: boolean;
}

export function FileUploader({ onFileSelect, isProcessing, disabled }: FileUploaderProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const validateAndSelectFile = (file: File) => {
    setError(null);
    if (file.type !== 'application/pdf') {
      setError('Por favor, selecciona un archivo PDF válido.');
      return;
    }
    // Limit to 15MB for example
    if (file.size > 15 * 1024 * 1024) {
      setError('El archivo es demasiado grande. El límite es de 15MB.');
      return;
    }
    onFileSelect(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    
    if (disabled) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      validateAndSelectFile(file);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndSelectFile(e.target.files[0]);
    }
  };

  const handleClick = () => {
    if (!disabled && inputRef.current) {
      inputRef.current.click();
    }
  };

  return (
    <div className="w-full">
      <div
        className={cn(
          "relative group border border-slate-200 rounded-lg p-10 sm:p-16 transition-all duration-300 ease-in-out text-center cursor-pointer overflow-hidden shadow-sm",
          isDragActive 
            ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20" 
            : "dark:border-slate-700 hover:border-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-800/50",
          disabled && "opacity-50 cursor-not-allowed",
          "bg-white dark:bg-slate-800"
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        aria-label="Subir archivo PDF"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleChange}
          disabled={disabled}
        />
        
        <div className="flex flex-col items-center justify-center space-y-4 pointer-events-none">
          <div className={cn(
            "p-4 rounded-full transition-colors duration-300",
            isDragActive ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400" : "bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/30 group-hover:text-indigo-600"
          )}>
            <UploadCloud className="w-10 h-10 sm:w-12 sm:h-12" />
          </div>
          
          <div className="space-y-1">
            <p className="text-lg sm:text-xl font-semibold text-slate-700 dark:text-slate-200">
              {isDragActive ? "Suelta tu PDF aquí" : "Haz clic o arrastra tu PDF"}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Soporta archivos de hasta 15MB
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-center space-x-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg text-sm font-medium border border-red-200 dark:border-red-800">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
