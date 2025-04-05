#include <iostream>
#include <string>    
#include <windows.h>  
#include <shellapi.h> 
#pragma comment(lib, "Shell32.lib")

int main()
{
    const std::string uri_narrow = "minecraft://openServersTab/";
    int bufferSize = MultiByteToWideChar(
        CP_UTF8,            
        0,                  
        uri_narrow.c_str(),
        -1,                
        nullptr,           
        0     
    );
    if (bufferSize == 0)
    {
        std::cerr << "Error: Failed to get buffer size for wide string conversion. Error code: "
                  << GetLastError() << std::endl;
        return 1; 
    }

    std::wstring uri_wide(bufferSize, 0); 
    int resultSize = MultiByteToWideChar(
        CP_UTF8,
        0,
        uri_narrow.c_str(),
        -1,
        &uri_wide[0],
        bufferSize);

    if (resultSize == 0)
    {
        std::cerr << "Error: Failed to convert URI to wide string. Error code: "
                  << GetLastError() << std::endl;
        return 1;
    }
    if (!uri_wide.empty() && uri_wide.back() == L'\0')
    {
        uri_wide.pop_back();
    }

    HINSTANCE result = ShellExecuteW(
        NULL,           
        L"open",         
        uri_wide.c_str(),
        NULL,           
        NULL,             
        SW_SHOWNORMAL   
    );
    if ((intptr_t)result > 32)
    { /* None... */ }
    else
    {
        std::wcerr << L"Error: Failed to open URI. Error code: " << (intptr_t)result << std::endl;
        std::wcerr << L"Please ensure the Minecraft Launcher is installed and the URI scheme 'minecraft://' is correctly associated." << std::endl;
        return 1; 
    }
    return 0; 
}