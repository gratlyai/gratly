import requests
import json
import configparser
import pymysql
from datetime import datetime, date, timedelta,timezone
import pytz
from zoneinfo import ZoneInfo

def load_config(path):
    """
    Reads configuration from a specified file.
    """
    config = configparser.ConfigParser()
    config.read(path)
    return config

def convert_utc_pacific(date_utc):
    if not date_utc:
        return None

    if isinstance(date_utc, datetime):
        dt = date_utc
    else:
        formats = [
            '%Y-%m-%dT%H:%M:%S.%f%z',  # with milliseconds
            '%Y-%m-%dT%H:%M:%S%z',     # without milliseconds
            '%Y-%m-%dT%H:%M:%SZ',      # Zulu time
        ]

        dt = None
        for fmt in formats:
            try:
                dt = datetime.strptime(date_utc, fmt)
                break
            except ValueError:
                continue

        if dt is None:
            return None  # or log bad value

    pacific_tz = pytz.timezone('US/Pacific')
    return dt.astimezone(pacific_tz)
        
def convert_pacific_utc(date_pacific):
    pacific_tz = pytz.timezone('US/Pacific')
    dt_object_naive = datetime.strptime(date_pacific, '%Y-%m-%d')
    dt_object_pacific = pacific_tz.localize(dt_object_naive)
    dt_object_utc = dt_object_pacific.astimezone(pytz.utc)
    output_format_base = '%Y-%m-%dT%H:%M:%S'
    utc_time_formatted_base = dt_object_utc.strftime(output_format_base)
    utc_time_formatted = f"{utc_time_formatted_base}.000-0000"
    return utc_time_formatted

start_date = convert_pacific_utc((date.today() - timedelta(days=1)).strftime('%Y-%m-%d'))
end_date = convert_pacific_utc((date.today() + timedelta(days=1)).strftime('%Y-%m-%d'))
business_date = (date.today() - timedelta(days=1)).strftime('%Y%m%d')

# print(start_date,end_date,business_date)

def main():
    config = load_config('setting.ini')

    #with open('authtoken.json', 'r') as file:
      #  accesstoken = file.read()

    # Access parameters by section and key
    # db_host = config['DATABASE']['host']
    # db_user = config['DATABASE']['user']
    # db_pwd = config['DATABASE']['password']
    # db_db = config['DATABASE']['database']
    
    # Database connection details
    db_config = {
        'host': config['DATABASE']['host'],
        'user': config['DATABASE']['user'],
        'password': config['DATABASE']['password'],
        'database': config['DATABASE']['database']
    }
    
    # headers_init = config['HEADER']['toastguid']
    
    # Get all the URLs from the setting.ini 
    
    urls = config['URLS']['url']
    delimiter = ','
    all_url = urls.split(delimiter)
    
    # Initiate the MySQL connection
    
    conn = pymysql.connect(**db_config, cursorclass=pymysql.cursors.DictCursor)
    cursor = conn.cursor()
    
    cursor.execute("select restaurantID,secretkey,clientsecret,useraccesstype from calctip.onboarding")
    get_results = cursor.fetchall()
    
    for row in get_results:
        payload = {
        "clientId": row['secretkey'],
        "clientSecret": row['clientsecret'],
        "userAccessType": row['useraccesstype']
        }
        headers_init = row['restaurantID']
        headers = {"Content-Type": "application/json"}
        authurl = 'https://ws-api.toasttab.com/authentication/v1/authentication/login'
        response = requests.post(authurl, json=payload, headers=headers)
        
        data = response.json()

        pretty_json_output = json.dumps(data, indent=4)
        access_token = json.loads(pretty_json_output)
        accesstoken = f"Bearer {access_token['token']['accessToken']}"
        
        headers = {
        "Toast-Restaurant-External-ID": headers_init,
        "Authorization": accesstoken
        }
                

        for url in all_url:
            # print(f"URL IS {url}")
    
            if url == 'https://ws-api.toasttab.com/restaurants/v1/restaurants/':
                url = f"{url}{headers_init}"
                # print(f"URL IS {url}")
                response = requests.get(url, headers=headers)
                data = response.json()
                
                # pretty_json_output = json.dumps(data, indent=4)
                # with open('getrestaurantdetails.json', 'w') as json_file:
                    # json_file.write(pretty_json_output)
                    
                #sql query to truncate the table so that new data could be loaded
                truncate_query = "TRUNCATE TABLE calctip.RestaurantDetails"
                cursor.execute(truncate_query)
                conn.commit() 
                    
                # SQL query to insert data
                restaurant_sql_query = "INSERT INTO calctip.RestaurantDetails (restaurantID,name,locationName,locationCode,description,timeZone,currencyCode,firstBusinessDate,archived,address1,address2,city,stateCode,zipCode,country,phone,website,orderOnline) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                restaurant_sql_data = [(headers_init,data['general']['name'],data['general']['locationName'],data['general']['locationCode'],data['general']['description'],data['general']['timeZone'],data['general']['currencyCode'],data['general']['firstBusinessDate'],data['general']['archived'],data['location']['address1'],data['location']['address2'],
                                        data['location']['city'],data['location']['stateCode'],data['location']['zipCode'],data['location']['country'],data['location']['phone'],data['urls']['website'],data['urls']['orderOnline'])]

                cursor.executemany(restaurant_sql_query, restaurant_sql_data)
                conn.commit()
            
            if url == 'https://ws-api.toasttab.com/labor/v1/jobs':
                response = requests.get(url, headers=headers)
                data = response.json()    
                
                #sql query to truncate the table so that new data could be loaded
                truncate_query = "TRUNCATE TABLE calctip.Jobs"
                cursor.execute(truncate_query)
                conn.commit()   
                
                # SQL query to insert data
                jobs_sql_query = "INSERT INTO calctip.Jobs(restaurantID,jobID,jobTitle,entitytype,createdDate,deleted,deletedDate,code,tipped,defaultWage,wageFrequency) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                jobs_sql_data = [(headers_init,record['guid'],record['title'],record['entityType'],record['createdDate'][0:10],record['deleted'],record['deletedDate'][0:10],record['code'],record['tipped'],record['defaultWage'],record['wageFrequency']) for record in data]

                cursor.executemany(jobs_sql_query, jobs_sql_data)
                conn.commit()     
                
            if url == 'https://ws-api.toasttab.com/labor/v1/employees':
                response = requests.get(url, headers=headers)
                data = response.json()    
                
                #sql query to truncate the table so that new data could be loaded
                truncate_query = "TRUNCATE TABLE calctip.Employees"
                cursor.execute(truncate_query)
                conn.commit()   
                
                # SQL query to insert data
                employees_sql_query = "INSERT INTO calctip.Employees (restaurantID,employeeID,employeeFname,employeeLname,chosenName,phoneNumber,email,deleted,deletedDate) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)"
                employees_sql_data = [(headers_init,record['guid'],record['firstName'],record['lastName'],record['chosenName'],record['phoneNumber'],record['email'],record['deleted'],record['deletedDate'][0:10]) for record in data]

                cursor.executemany(employees_sql_query, employees_sql_data)
                conn.commit()   
                
                #sql query to truncate the table so that new data could be loaded

                truncate_query = "TRUNCATE TABLE calctip.EmployeeRole"
                cursor.execute(truncate_query)
                conn.commit() 
                
                # Prepare data for insertion (list of tuples)
                employeejobs_to_insert = []
                
                # SQL query to insert data
                employee_job_sql_query = "INSERT INTO calctip.EmployeeRole (restaurantID,employeeID,name,jobID) VALUES (%s, %s, %s, %s)"
                
                for record in data:
                    restaurantID = headers_init
                    employeeID = record['guid']
                    name = record['firstName'] + ' ' + record['lastName']
                    for job in record['jobReferences']:
                        if job['guid'] is None:
                            jobID = 'N/A'
                        else:
                            jobID = job['guid']
                        employeejobs_to_insert.append([restaurantID,employeeID,name,jobID])
                cursor.executemany(employee_job_sql_query, employeejobs_to_insert)
                conn.commit()
                
            if url == 'https://ws-api.toasttab.com/labor/v1/timeEntries':
                
                query = {
                    "startDate": start_date,
                    "endDate": end_date,
                    "includeArchived": "true",
                    "includeMissedBreaks": "true"
                    }
                response = requests.get(url, headers=headers, params=query)
                data = response.json()   
                
                #sql query to truncate the table so that new data could be loaded
                truncate_query = "TRUNCATE TABLE calctip.TimeEntries"
                cursor.execute(truncate_query)
                conn.commit()   
                
                # SQL query to insert data
                timeentries_sql_query = """INSERT INTO calctip.TimeEntries(restaurantID,timeEntryID,entityType,externalID,employeeID,jobID,shiftReference,inDate,outDate,businessDate,regularHours,overtimeHours,hourlyWage,tipsWithheld,nonCashSales,cashSales,nonCashGratuityServiceCharges,CashGratuityServiceCharges,
                            nonCashTips,declaredCashTips,autoClockedOut,deleted,createdDate,modifiedDate,deletedDate) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"""
                
                

                
                timeentries_sql_data = [(headers_init,record['guid'],record['entityType'],record['externalId'],record['employeeReference']['guid'],record['jobReference']['guid'],record['shiftReference'],
                                                convert_utc_pacific(record['inDate']),convert_utc_pacific(record['outDate']),record['businessDate'],record['regularHours'],record['overtimeHours'],record['hourlyWage'],
                                                record['tipsWithheld'],record['nonCashSales'],record['cashSales'],record['nonCashGratuityServiceCharges'],record['cashGratuityServiceCharges'],record['nonCashTips'],
                                                record['declaredCashTips'],record['autoClockedOut'],record['deleted'],record['createdDate'],record['modifiedDate'],record.get('deletedDate',None)) for record in data]
                                        
                cursor.executemany(timeentries_sql_query, timeentries_sql_data)
                conn.commit()  
                
            if url == 'https://ws-api.toasttab.com/orders/v2/ordersBulk':
                query = {
                        "businessDate": business_date
                        }
                response = requests.get(url, headers=headers, params=query)
                data = response.json()    
                
                #sql query to truncate the table so that new data could be loaded
                truncate_query = "TRUNCATE TABLE calctip.AllOrders"
                cursor.execute(truncate_query)
                conn.commit()  
                
                all_orders_sql_data = []
                
                # SQL query to insert data
                all_orders_sql_query = """INSERT INTO calctip.AllOrders(restaurantID,orderID,displayNumber,businessDate,orderSource,tableID,orderPaidDate,voided,openedDate,prepTime,paymentType,refundStatus,paymentStatus,netAmount,
                                                        tipAmount,taxAmount,totalAmount,employeeID,numberOfGuests,duration,approvalStatus) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"""
                
                for record in data:
                    restaurantID = headers_init
                    orderID = record['guid']
                    displayNumber = record['displayNumber']
                    businessDate = record['businessDate']
                    orderSource = record['source']
                    tableID = (record.get("table") or {}).get("guid"," ") 
                    if record.get("checks", [{}])[0].get("paymentStatus") != 'OPEN':
                        orderPaidDate = convert_utc_pacific(record['paidDate'])
                        paymentType = record.get("checks", [{}])[0].get("payments", [{}])[0].get("type")
                        refundStatus = record.get("checks", [{}])[0].get("payments", [{}])[0].get("refundStatus")
                        paymentStatus = record.get("checks", [{}])[0].get("paymentStatus")
                        netAmount = record.get("checks", [{}])[0].get("payments", [{}])[0].get("amount")
                        tipAmount = record.get("checks", [{}])[0].get("payments", [{}])[0].get("tipAmount")
                        taxAmount = record.get("checks", [{}])[0].get("taxAmount")
                        totalAmount = record.get("checks", [{}])[0].get("totalAmount")
                    else:
                        orderPaidDate = '' 
                        paymentType = ''
                        refundStatus = ''
                        paymentStatus = ''
                        netAmount = 0.0
                        tipAmount = 0.0
                        taxAmount = 0.0
                        totalAmount = 0.0
                    voided = record['voided']
                    openedDate = convert_utc_pacific(record['openedDate'])
                    prepTime = record['requiredPrepTime']
                    employeeID = record['server']['guid']
                    numberOfGuests = record['numberOfGuests']
                    duration = record['duration']
                    approvalStatus = record['approvalStatus']
                
                    all_orders_sql_data.append([restaurantID,orderID,displayNumber,businessDate,orderSource,tableID,orderPaidDate,voided,openedDate,prepTime,paymentType,refundStatus,paymentStatus,netAmount,
                                                        tipAmount,taxAmount,totalAmount,employeeID,numberOfGuests,duration,approvalStatus])
                
                # all_orders_sql_data = [(headers_init,record['guid'],record['displayNumber'],record['businessDate'],record['source'],convert_utc_pacific(record['paidDate']),record['voided'],convert_utc_pacific(record['openedDate']),
                                        # record['requiredPrepTime'],record['checks']['payments']['type'],record['checks']['payments']['refundStatus'],record['checks']['paymentStatus'],record['checks']['payments']['amount'],
                                        # record['checks']['payments']['tipAmount'],record['checks']['taxAmount'],record['checks']['totalAmount'],record['server']['guid'],record['numberOfGuests'],record['duration'],record['approvalStatus']) for record in data]

                cursor.executemany(all_orders_sql_query, all_orders_sql_data)
                conn.commit()  
                
            if url == 'https://ws-api.toasttab.com/config/v2/tables':
                    
                response = requests.get(url, headers=headers)
                data = response.json()    
                
                #sql query to truncate the table so that new data could be loaded
                truncate_query = "TRUNCATE TABLE calctip.Tables"
                cursor.execute(truncate_query)
                conn.commit()   
                
                # SQL query to insert data
                tables_sql_query = "INSERT INTO calctip.Tables(restaurantID,tableID,entityType,tableName) VALUES (%s, %s, %s, %s)"
                
                tables_sql_data = [(headers_init,record['guid'],record['entityType'],record['name']) for record in data]
                        
                cursor.executemany(tables_sql_query, tables_sql_data)
                conn.commit()                 
                
        if conn.open:
            cursor.close()
            conn.close()

if __name__ == "__main__":
    main()
