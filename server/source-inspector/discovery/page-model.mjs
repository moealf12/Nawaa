export function detectPageModel(text=""){
 const value=String(text);
 if(value.includes("pageSize=")&&(value.includes("pg=")||value.includes("page=")))return {ok:true,model:"page",evidence:"page-parameters"};
 if(value.includes("cursor="))return {ok:true,model:"cursor",evidence:"cursor-parameter"};
 if(value.includes("offset="))return {ok:true,model:"offset",evidence:"offset-parameter"};
 return {ok:false,model:null,evidence:null};
}
