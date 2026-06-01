/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { Header } from './components/Header';
import { FileUploader } from './components/FileUploader';
import { SummaryResult } from './components/SummaryResult';
import { FileText } from 'lucide-react';
import type { ScientificReview } from './types';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [summary, setSummary] = useState<ScientificReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setSummary(null);
    setIsProcessing(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('pdf', selectedFile);

    try {
      const data = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/summarize-pdf');
        xhr.setRequestHeader('Accept', 'application/json');

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100);
            setUploadProgress(progress);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch (e) {
              const preview = xhr.responseText.slice(0, 200);
              reject(new Error(`Respuesta del servidor inválida (200). Texto recibido:\n${preview}`));
            }
          } else {
            try {
              const errData = JSON.parse(xhr.responseText);
              reject(new Error(errData.error || 'Ocurrió un error inesperado al procesar el archivo.'));
            } catch (e) {
              reject(new Error('Ocurrió un error inesperado al procesar el archivo.'));
            }
          }
        };

        xhr.onerror = () => reject(new Error('Error de conexión. Inténtalo de nuevo más tarde.'));
        xhr.send(formData);
      });

      setSummary(data.summary);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error de conexión. Inténtalo de nuevo más tarde.');
    } finally {
      setIsProcessing(false);
      setUploadProgress(0);
    }
  };

  const handleReset = () => {
    setFile(null);
    setSummary(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-colors duration-300 font-sans">
      <Header />
      
      <main className="max-w-4xl mx-auto px-4 py-8 sm:py-12">
        <div className="space-y-8">
          {!summary && !isProcessing && (
            <div className="text-center space-y-4 max-w-2xl mx-auto">
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
                Auditor Científico IA
              </h1>
              <p className="text-slate-600 dark:text-slate-400 text-lg">
                Sube tu paper en PDF. Analizaremos meticulosamente su credibilidad, rigor metodológico y posibles sesgos en segundos.
              </p>
            </div>
          )}

          {!file ? (
            <div className="mt-8">
              <FileUploader onFileSelect={handleFileSelect} isProcessing={isProcessing} disabled={isProcessing} />
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <div className="flex items-center space-x-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-medium text-sm sm:text-base line-clamp-1">{file.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </div>
                {!isProcessing && (
                  <button 
                    onClick={handleReset}
                    className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                  >
                    Subir otro
                  </button>
                )}
              </div>

              {isProcessing && (
                <div className="flex flex-col items-center justify-center py-16 space-y-8 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 px-6">
                  {uploadProgress < 100 ? (
                    <div className="w-full max-w-md space-y-3">
                       <div className="flex justify-between items-end text-sm font-bold text-slate-700 dark:text-slate-300">
                         <span>Subiendo documento al servidor...</span>
                         <span className="text-xl text-indigo-600 dark:text-indigo-400">{uploadProgress}%</span>
                       </div>
                       <div className="w-full bg-slate-100 dark:bg-slate-900 rounded-full h-3 overflow-hidden shadow-inner border border-slate-200 dark:border-slate-800">
                         <div 
                           className="bg-indigo-600 h-full rounded-full transition-all duration-300 relative overflow-hidden" 
                           style={{ width: `${uploadProgress}%` }}
                         >
                           <div className="absolute inset-0 bg-white/20 -skew-x-12 translate-x-[-100%] animate-[shimmer_2s_infinite]" />
                         </div>
                       </div>
                    </div>
                  ) : (
                    <div className="space-y-6 flex flex-col items-center">
                      <div className="relative">
                        <div className="w-16 h-16 border-4 border-slate-100 dark:border-slate-700 rounded-full"></div>
                        <div className="w-16 h-16 border-4 border-indigo-600 dark:border-indigo-500 rounded-full border-t-transparent animate-spin absolute top-0 left-0"></div>
                      </div>
                      <div className="text-center space-y-2">
                        <h3 className="text-xl font-bold animate-pulse text-slate-800 dark:text-slate-100">Auditando archivo empírico...</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          Nuestra IA está diseccionando sesgos y buscando p-hacking.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
                  <p className="font-medium">Error al procesar el archivo</p>
                  <p className="text-sm mt-1">{error}</p>
                </div>
              )}

              {summary && (
                <SummaryResult content={summary} />
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
