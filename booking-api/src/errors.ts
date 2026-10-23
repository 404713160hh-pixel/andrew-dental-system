export class AppError extends Error {
 constructor(public status:number,public code:string,message:string,public details?:unknown){super(message);}
}
export function requireThat(value:unknown,status:number,code:string,message:string):asserts value {
 if(!value) throw new AppError(status,code,message);
}
export function databaseError(error:unknown): AppError | undefined {
 const code=(error as {code?:string}).code;
 if(code==='23P01') return new AppError(409,'RESOURCE_CONFLICT','该资源已被占用，请重新查询时段');
 if(code==='23505') return new AppError(409,'DUPLICATE_RECORD','该记录或操作已存在');
 if(code==='23503') return new AppError(400,'RELATED_RECORD_REQUIRED','关联资料不存在或仍被使用');
 if(code==='23514') return new AppError(409,'BUSINESS_CONSTRAINT','数据不符合业务约束，请刷新后重试');
 if(code==='40001'||code==='40P01') return new AppError(409,'RETRY_SAME_COMMAND','并发操作未完成，请使用原操作编号重试');
 return undefined;
}
