import { Schema, model, Document, Types } from 'mongoose';
import { applyEmissionSeriesIndex, emissionSeriesFields } from './emissionSeries';

export interface IWithholding extends Document {
  empresa_emisora_id: Types.ObjectId;
  fecha_emision: Date;
  clave_acceso: string;
  secuencial: string;
  tipo_ambiente: number;
  codigo_establecimiento: string;
  punto_emision: string;
  estado: string;
  tipo_identificacion_sujeto_retenido: string;
  razon_social_sujeto_retenido: string;
  identificacion_sujeto_retenido: string;
  periodo_fiscal: string;
  total_retenido: number;
  docs_sustento: any[];
  xml: string;
  xml_firmado: string;
  autorizacion_numero: string;
  fecha_autorizacion: Date;
  sri_estado?: string;
  sri_mensajes?: any;
  sri_fecha_envio?: Date;
  sri_fecha_respuesta?: Date;
  datos_originales?: string;
}

const schema = new Schema<IWithholding>({
  empresa_emisora_id: { type: Schema.Types.ObjectId, ref: 'IssuingCompany', required: true },
  fecha_emision: { type: Date, required: true },
  clave_acceso: { type: String, required: true },
  secuencial: { type: String, required: true },
  ...emissionSeriesFields,
  estado: { type: String, required: true },
  tipo_identificacion_sujeto_retenido: { type: String, required: true },
  razon_social_sujeto_retenido: { type: String, required: true },
  identificacion_sujeto_retenido: { type: String, required: true },
  periodo_fiscal: { type: String, required: true },
  total_retenido: { type: Number, required: true },
  docs_sustento: { type: Schema.Types.Mixed, required: true },
  xml: { type: String },
  xml_firmado: { type: String },
  autorizacion_numero: { type: String },
  fecha_autorizacion: { type: Date },
  sri_estado: { type: String },
  sri_mensajes: { type: Schema.Types.Mixed },
  sri_fecha_envio: { type: Date },
  sri_fecha_respuesta: { type: Date },
  datos_originales: { type: String },
});

applyEmissionSeriesIndex(schema);

export default model<IWithholding>('Withholding', schema);
