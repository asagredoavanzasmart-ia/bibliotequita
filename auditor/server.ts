import express from 'express';
import path from 'path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs';

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Initialize Gemini API
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  app.post('/api/summarize-pdf', upload.single('pdf'), async (req, res) => {
    try {
      if (!req.file) {
      	res.status(400).json({ error: 'No se subió ningún archivo PDF.' });
        return;
      }
      
      const fileBuffer = req.file.buffer;
      const base64Data = fileBuffer.toString('base64');
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: [
          {
            text: `Por favor, actúa como un revisor experto de artículos científicos e investigativos. Lee el documento adjunto y realiza un análisis crítico, implacable y exhaustivo. Devuelve ÚNICAMENTE un objeto JSON estricto.`
          },
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: base64Data
            }
          }
        ],
        config: {
          systemInstruction: 'Eres un analista experto en integridad y rigor científico. Tu trabajo es desgranar papers, buscar fallos metodológicos, identificar sesgos y traducir la ciencia real para el público general, evitando el sensacionalismo.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              auditoria_epistemologica: {
                type: Type.OBJECT,
                properties: {
                  grado_de_corroboracion_objetiva: { type: Type.STRING },
                  infradeterminacion_explicaciones_alternativas: { type: Type.STRING }
                },
                required: ["grado_de_corroboracion_objetiva", "infradeterminacion_explicaciones_alternativas"]
              },
              diseccion_teorica_y_conceptual: {
                type: Type.OBJECT,
                properties: {
                  falsabilidad_y_riesgo_popperiano: { type: Type.STRING },
                  brecha_de_validez_de_constructo: { type: Type.STRING },
                  hipotesis_ad_hoc_lakatosianas: { type: Type.STRING }
                },
                required: ["falsabilidad_y_riesgo_popperiano", "brecha_de_validez_de_constructo", "hipotesis_ad_hoc_lakatosianas"]
              },
              escrutinio_metodologico_y_estadistico: {
                type: Type.OBJECT,
                properties: {
                  adecuacion_y_omision_de_controles: { type: Type.STRING },
                  robustez_y_relevancia_real: { type: Type.STRING },
                  rastros_de_p_hacking: { type: Type.STRING }
                },
                required: ["adecuacion_y_omision_de_controles", "robustez_y_relevancia_real", "rastros_de_p_hacking"]
              },
              auditoria_de_sesgos_y_datos_faltantes: {
                type: Type.OBJECT,
                properties: {
                  sesgo_de_reporte_interno: { type: Type.STRING },
                  alineacion_de_incentivos: { type: Type.STRING }
                },
                required: ["sesgo_de_reporte_interno", "alineacion_de_incentivos"]
              },
              detector_de_cientificismo_y_banderas_rojas: {
                type: Type.OBJECT,
                properties: {
                  brecha_causal_y_extrapolacion: { type: Type.STRING },
                  cherry_picking_contextual: { type: Type.STRING },
                  opacidad_para_refutacion: { type: Type.STRING }
                },
                required: ["brecha_causal_y_extrapolacion", "cherry_picking_contextual", "opacidad_para_refutacion"]
              },
              sintesis_para_el_pensamiento_critico: {
                type: Type.OBJECT,
                properties: {
                  la_realidad_de_los_datos_crudos: { type: Type.STRING },
                  traduccion_de_la_incertidumbre_al_mundo_real: { type: Type.STRING }
                },
                required: ["la_realidad_de_los_datos_crudos", "traduccion_de_la_incertidumbre_al_mundo_real"]
              }
            },
            required: [
              "auditoria_epistemologica",
              "diseccion_teorica_y_conceptual",
              "escrutinio_metodologico_y_estadistico",
              "auditoria_de_sesgos_y_datos_faltantes",
              "detector_de_cientificismo_y_banderas_rojas",
              "sintesis_para_el_pensamiento_critico"
            ]
          }
        }
      });
      
      const rawText = response.text || '{}';
      const cleanedText = rawText.replace(/```json\n?|\n?```/g, '');
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(cleanedText);
      } catch (err) {
        console.error('Failed to parse JSON response', rawText);
        throw new Error('La respuesta de la IA no tenía un formato JSON válido.');
      }
      
      res.json({ summary: parsedResponse });
    } catch (error: any) {
      console.error('Error al resumir el PDF:', error);
      res.status(500).json({ error: 'Hubo un error al procesar el archivo. Por favor, inténtalo de nuevo más tarde.' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
