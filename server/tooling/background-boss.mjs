import PgBoss from "pg-boss";
// Durable jobs only with an already configured PostgreSQL instance.
// No auto-start, schema creation, paid service, or customer-search changes.
export function backgroundBossConfigured(env=process.env){
 return Boolean(env.DATABASE_URL&&env.NAWAA_ENABLE_BACKGROUND_JOBS==="1");
}
export function createBackgroundBoss({env=process.env,logger=undefined}={}){
 if(!backgroundBossConfigured(env))throw new Error("background_jobs_disabled");
 const config={connectionString:env.DATABASE_URL,schema:"nawaa_jobs",application_name:"nawaa-background"};
 if(env.DATABASE_SSL==="false")config.ssl=false;
 else config.ssl={rejectUnauthorized:true};
 if(logger)config.logger=logger;
 return new PgBoss(config);
}
// Caller explicitly starts/stops and schedules work after DB permission checks.
