package main
import("encoding/json";"fmt";"os";"net/url")
func main(){
 b,e:=os.ReadFile("uee-sandbox/polyglot/results.json");if e!=nil{panic(e)}
 var doc map[string]any;if e=json.Unmarshal(b,&doc);e!=nil{panic(e)}
 products,ok:=doc["python_products"].([]any);if !ok||len(products)!=2{panic("missing products")}
 seen:=map[string]bool{}
 for _,raw:=range products{
  p:=raw.(map[string]any);image,ok:=p["image"].(string);if !ok{panic("missing image")}
  u,e:=url.Parse(image);if e!=nil||u.Scheme!="https"||u.Host==""{panic("invalid image URL")}
  if seen[image]{panic("duplicate image")};seen[image]=true
 }
 doc["go_unique_images"]=len(seen)
 data,_:=json.MarshalIndent(doc,"","  ");if e=os.WriteFile("uee-sandbox/polyglot/results.json",data,0644);e!=nil{panic(e)}
 fmt.Println("GO_IMAGE_URLS_VALID",len(seen))
}
